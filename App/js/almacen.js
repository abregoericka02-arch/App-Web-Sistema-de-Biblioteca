/* ==============================================================================
   ALMACÉN DE DATOS Y REGLAS DEL SISTEMA (JavaScript puro, sin servidor)
   ==============================================================================
   - Guarda todo en localStorage (libros, usuarios, préstamos, reservas...).
   - Expone una sola función, api(ruta, cuerpo), que usa app.js igual que antes
     usaba fetch(): recibe una acción y devuelve { ok, mensaje | error, status }.
   - Aquí viven las reglas: máximo de préstamos, multas, reservas, roles, validaciones.
   ============================================================================== */
(() => {
    'use strict';

    const CLAVE = 'biblioteca_datos_v1', CLAVE_SESION = 'biblioteca_sesion';
    const MAX_ACTIVOS = 3, DIAS_LECTOR = 7, DIAS_RENOVACION = 7, MULTA = 0.25, DIAS_RESERVA = 3;
    const TZ = 'America/Panama';
    const REGEX_USUARIO = /^[a-z0-9_.]{3,20}$/;
    let BD = null; // Copia en memoria de los datos guardados

    /* ----- Fechas (hora de Panamá) ----- */
    const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });                 // AAAA-MM-DD
    const ahora = (ms = 0) => new Date(Date.now() + ms).toLocaleString('sv-SE', { timeZone: TZ }); // AAAA-MM-DD HH:MM:SS
    const sumaDias = (f, n) => { const d = new Date(f + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const difDias = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5);

    /* ----- Utilidades ----- */
    const ok = (mensaje = '', extra = {}) => ({ ok: true, status: 200, mensaje, ...extra });
    const fallo = (error, status = 400) => ({ ok: false, status, error });
    const texto = v => String(v ?? '').trim();
    const entero = v => (/^-?\d+$/.test(texto(v)) ? Number(texto(v)) : false);
    const correoValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const dinero = n => 'B/. ' + n.toFixed(2);

    // Contraseñas: nunca se guardan en texto plano, sino su huella SHA-256 (con respaldo simple si el navegador no la ofrece)
    async function hash(t) {
        const s = 'biblioteca$' + t;
        try {
            const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
            return 'sha256:' + [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
        } catch {
            let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
            return 'djb:' + h;
        }
    }

    /* ----- Lectura y escritura en localStorage ----- */
    let sesionMem = 0; // Respaldo en memoria por si el navegador bloquea el almacenamiento
    const cargarBD = () => { try { const v = JSON.parse(localStorage.getItem(CLAVE)); if (v && v.libros) BD = v; } catch { /* se conserva la copia en memoria */ } return BD && BD.libros ? BD : null; };
    const guardarBD = () => { try { localStorage.setItem(CLAVE, JSON.stringify(BD)); return true; } catch { return false; } };
    const verSesion = () => { try { const v = sessionStorage.getItem(CLAVE_SESION); return v === null ? sesionMem : Number(v) || 0; } catch { return sesionMem; } };
    const ponerSesion = id => { sesionMem = id || 0; try { id ? sessionStorage.setItem(CLAVE_SESION, id) : sessionStorage.removeItem(CLAVE_SESION); } catch { /* solo memoria */ } };

    // Primera vez: se crean los datos de ejemplo (3 usuarios, 6 libros y un préstamo vencido)
    async function iniciar() {
        const usr = async (id, rol, nombre, usuario, pass) => ({ id, rol, nombre, usuario, email: usuario + '@biblioteca.com', hash: await hash(pass), debeCambiar: false });
        BD = {
            categorias: [...SEMILLA.categorias],
            libros: SEMILLA.libros.map(l => ({ ...l })),
            usuarios: [await usr(1, 'admin', 'Administrador', 'admin', 'admin123'), await usr(2, 'lector', 'Lector Demo', 'lector', 'lector123'), await usr(3, 'bibliotecario', 'Bibliotecario', 'biblio', 'biblio123')],
            prestamos: [{ id: 1, libroId: 3, lectorId: 2, fecha: sumaDias(hoy(), -10), limite: sumaDias(hoy(), -3), devuelto: null, renovado: false, multaPagada: false }],
            reservas: [], solicitudes: [],
            sig: { libro: 7, usuario: 4, prestamo: 2, reserva: 1, solicitud: 1 }
        };
        guardarBD();
    }

    /* ----- Consultas y reglas ----- */
    const usuarioActual = () => BD.usuarios.find(u => u.id === verSesion()) || null;
    const esStaff = u => !!u && !u.debeCambiar && ['admin', 'bibliotecario'].includes(u.rol);
    const prestadosDe = id => BD.prestamos.filter(p => p.libroId === id && !p.devuelto).length;
    const apartadosDe = id => BD.reservas.filter(r => r.libroId === id && r.aviso).length;
    const deuda = id => BD.prestamos.filter(p => p.lectorId === id && !p.multaPagada)
        .reduce((s, p) => s + Math.max(difDias(p.devuelto || hoy(), p.limite), 0), 0) * MULTA;

    // Exige sesión y permiso; devuelve un error o null si todo está bien
    function exigir(u, nivel = 'login') {
        if (!u) return fallo('Debes iniciar sesión.', 401);
        if (u.debeCambiar && nivel !== 'temporal') return fallo('Debes cambiar tu contraseña temporal antes de continuar. Entra a "Configurar perfil".', 403);
        if (nivel === 'staff' && !['admin', 'bibliotecario'].includes(u.rol)) return fallo('No tienes permiso para esta acción.', 403);
        if (nivel === 'admin' && u.rol !== 'admin') return fallo('Solo el administrador puede hacer esto.', 403);
        return null;
    }

    // Libera apartados vencidos y aparta ejemplares libres a quien espera (en orden de llegada)
    function procesarReservas(libroId = null) {
        const limite = ahora(-DIAS_RESERVA * 864e5);
        BD.reservas = BD.reservas.filter(r => !(r.aviso && r.aviso < limite));
        const ids = libroId !== null ? [libroId] : [...new Set(BD.reservas.filter(r => !r.aviso).map(r => r.libroId))];
        ids.forEach(id => {
            const l = BD.libros.find(x => x.id === id);
            if (!l) return;
            const libres = l.copias - prestadosDe(id) - apartadosDe(id);
            BD.reservas.filter(r => r.libroId === id && !r.aviso).sort((a, b) => a.id - b.id)
                .slice(0, Math.max(libres, 0)).forEach(r => { r.aviso = ahora(); });
        });
    }

    const errorUsuario = (nuevo, idExcluir) => {
        if (!REGEX_USUARIO.test(nuevo)) return 'El usuario debe tener de 3 a 20 caracteres (letras, números, _ o .).';
        if (BD.usuarios.some(u => u.usuario === nuevo && u.id !== idExcluir)) return 'Ese nombre de usuario ya existe.';
        return null;
    };

    async function crearUsuario(d, rol) {
        const nombre = texto(d.nombre), email = texto(d.email).toLowerCase(), pass = String(d.pass ?? '');
        const entrada = texto(d.usuario), nick = (entrada !== '' ? entrada : nombre).toLowerCase();
        if (nombre.length < 2) return 'Escribe tu nombre completo.';
        if (nombre.length > 100) return 'El nombre es demasiado largo (máximo 100 caracteres).';
        if (entrada !== '' && !REGEX_USUARIO.test(nick)) return 'El usuario debe tener de 3 a 20 caracteres (letras, números, _ o .).';
        if (!correoValido(email) || email.length > 150) return 'El correo no es válido.';
        if (pass.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
        if (nick.length > 100) return 'El nombre de usuario es demasiado largo.';
        if (BD.usuarios.some(u => u.usuario === nick)) return 'Ese nombre de usuario ya existe.';
        if (BD.usuarios.some(u => u.email === email)) return 'Ese correo ya está registrado.';
        if (!['lector', 'bibliotecario'].includes(rol)) return 'Rol no válido.';
        BD.usuarios.push({ id: BD.sig.usuario++, rol, nombre, usuario: nick, email, hash: await hash(pass), debeCambiar: false });
        return null;
    }

    /* ==========================================================================
       RUTAS: una por cada módulo, igual que los antiguos archivos de /api
       ========================================================================== */
    const RUTAS = {
        // ----- Lectura de todos los datos (según el rol) -----
        datos() {
            procesarReservas();
            const u = usuarioActual(), staff = esStaff(u);
            const pub = x => ({ id: x.id, nombre: x.nombre, usuario: x.usuario, email: x.email, rol: x.rol, debeCambiar: !!x.debeCambiar });
            return ok('', {
                sesion: u ? u.id : null, categorias: BD.categorias, multaDia: MULTA,
                libros: BD.libros.map(l => ({ ...l, portada: l.portada || null, prestados: prestadosDe(l.id), apartados: apartadosDe(l.id) })),
                usuarios: staff ? BD.usuarios.map(pub) : u ? [pub(u)] : [],
                prestamos: !u ? [] : BD.prestamos.filter(p => staff || p.lectorId === u.id),
                reservas: !u ? [] : BD.reservas.filter(r => staff || r.lectorId === u.id)
                    .map(r => ({ ...r, vence: r.aviso ? sumaDias(r.aviso.slice(0, 10), DIAS_RESERVA) : null })),
                solicitudes: u && u.rol === 'admin' ? BD.solicitudes.filter(s => !s.atendida).sort((a, b) => a.fecha.localeCompare(b.fecha))
                    .map(s => { const x = BD.usuarios.find(y => y.id === s.usuarioId) || {}; return { id: s.id, usuarioId: s.usuarioId, nombre: x.nombre, email: x.email, fecha: s.fecha }; }) : []
            });
        },

        // ----- Sesión, registro, perfil y contraseña olvidada -----
        async sesion(acc, d) {
            if (acc === 'login') {
                const dato = texto(d.usuario).toLowerCase();
                const f = BD.usuarios.find(x => x.usuario === dato || x.email === dato);
                if (!dato || !f || f.hash !== await hash(String(d.pass ?? ''))) return fallo('Usuario o contraseña incorrectos.', 401);
                ponerSesion(f.id); return ok();
            }
            if (acc === 'logout') { ponerSesion(null); return ok(); }
            if (acc === 'registro') {
                const err = await crearUsuario(d, 'lector');
                return err ? fallo(err) : ok('Cuenta creada. Ya puedes iniciar sesión.');
            }
            if (acc === 'perfil') {
                const u = usuarioActual(), e = exigir(u, 'temporal'); if (e) return e;
                const nombre = texto(d.nombre), email = texto(d.email).toLowerCase(), nick = texto(d.usuario).toLowerCase();
                const actual = String(d.actual ?? ''), nueva = String(d.nueva ?? '');
                if (nombre.length < 2) return fallo('Escribe tu nombre completo.');
                if (nombre.length > 100) return fallo('El nombre es demasiado largo (máximo 100 caracteres).');
                if (!correoValido(email) || email.length > 150) return fallo('El correo no es válido.');
                if (BD.usuarios.some(x => x.email === email && x.id !== u.id)) return fallo('Ese correo ya está en uso.');
                const cambiaNick = nick !== '' && nick !== u.usuario;
                if (cambiaNick) { const err = errorUsuario(nick, u.id); if (err) return fallo(err); }
                if (u.debeCambiar && nueva === '') return fallo('Debes escribir una nueva contraseña para continuar.');
                if (u.debeCambiar && nueva === actual) return fallo('La nueva contraseña debe ser distinta de la temporal.');
                if (nueva !== '') {
                    if (u.hash !== await hash(actual)) return fallo('La contraseña actual no es correcta.');
                    if (nueva.length < 6) return fallo('La nueva contraseña debe tener al menos 6 caracteres.');
                    u.hash = await hash(nueva); u.debeCambiar = false;
                }
                u.nombre = nombre; u.email = email; if (cambiaNick) u.usuario = nick;
                return ok(cambiaNick ? 'Perfil actualizado. Ahora entras con el usuario «' + nick + '».' : 'Perfil actualizado.');
            }
            if (acc === 'olvide') {
                const dato = texto(d.usuario).toLowerCase();
                if (dato === '') return fallo('Escribe tu correo o tu nombre de usuario.');
                const f = BD.usuarios.find(x => x.usuario === dato || x.email === dato);
                if (f && f.rol !== 'admin' && !BD.solicitudes.some(s => s.usuarioId === f.id && !s.atendida)) {
                    BD.solicitudes.push({ id: BD.sig.solicitud++, usuarioId: f.id, fecha: ahora(), atendida: false });
                }
                return ok('Si la cuenta existe, el administrador recibió tu solicitud. Pasa por la biblioteca o espera a que te contacten.');
            }
        },

        // ----- Libros (solo personal) -----
        libros(acc, d) {
            const e = exigir(usuarioActual(), 'staff'); if (e) return e;
            if (acc === 'guardar') {
                const id = Number(d.id) || 0, titulo = texto(d.titulo), autor = texto(d.autor), isbn = texto(d.isbn);
                const categoria = texto(d.categoria), descripcion = texto(d.descripcion), anio = entero(d.anio), copias = entero(d.copias);
                if (titulo === '' || autor === '' || isbn === '') return fallo('Título, autor y código son obligatorios.');
                if (titulo.length > 200 || autor.length > 150 || isbn.length > 25) return fallo('Título (200), autor (150) o código (25) superan el largo permitido.');
                if (anio === false || anio < 1000 || anio > Number(hoy().slice(0, 4))) return fallo('El año no es válido.');
                if (copias === false || copias < 1 || copias > 50) return fallo('Los ejemplares deben estar entre 1 y 50.');
                if (!BD.categorias.includes(categoria)) return fallo('La categoría no es válida.');
                if (BD.libros.some(l => l.isbn === isbn && l.id !== id)) return fallo('Ya existe un libro con ese código.');
                let libro = BD.libros.find(l => l.id === id), mensaje;
                if (id > 0) {
                    if (!libro) return fallo('El libro ya no existe.', 404);
                    if (copias < prestadosDe(id)) return fallo('Hay más préstamos activos que ejemplares.');
                    Object.assign(libro, { titulo, autor, isbn, categoria, anio, copias, descripcion });
                    mensaje = 'Libro actualizado.';
                } else {
                    libro = { id: BD.sig.libro++, titulo, autor, isbn, categoria, anio, copias, descripcion, portada: null };
                    BD.libros.push(libro);
                    mensaje = 'Libro registrado.';
                }
                const portada = String(d.portada ?? '');
                if (portada !== '') {
                    if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(portada) && portada.length * 0.75 <= 600 * 1024) libro.portada = portada;
                    else mensaje += ' (La imagen de portada no era válida y no se guardó).';
                }
                procesarReservas(libro.id);
                return ok(mensaje);
            }
            if (acc === 'eliminar') {
                const id = Number(d.id) || 0;
                if (!BD.libros.some(l => l.id === id)) return fallo('El libro ya no existe.', 404);
                if (prestadosDe(id) > 0) return fallo('No se puede eliminar: el libro tiene préstamos activos.');
                BD.libros = BD.libros.filter(l => l.id !== id);
                BD.prestamos.forEach(p => { if (p.libroId === id) p.libroId = null; }); // El historial se conserva
                BD.reservas = BD.reservas.filter(r => r.libroId !== id);
                return ok('Libro eliminado.');
            }
        },

        // ----- Préstamos, devoluciones, renovaciones y cobro de multas -----
        prestamos(acc, d) {
            const u = usuarioActual(), e = exigir(u); if (e) return e;
            const staff = u.rol !== 'lector';
            if (acc === 'crear') {
                const libroId = Number(d.libro) || 0;
                const lectorId = staff ? Number(d.lector) || 0 : u.id;
                const dias = staff ? entero(d.dias) : DIAS_LECTOR;
                procesarReservas(libroId);
                const libro = BD.libros.find(l => l.id === libroId);
                if (!BD.usuarios.some(x => x.id === lectorId && x.rol === 'lector') || !libro) return fallo('Selecciona un lector y un libro.');
                if (dias === false || dias < 1 || dias > 30) return fallo('Los días deben estar entre 1 y 30.');
                const debe = deuda(lectorId);
                if (debe > 0) return fallo('Hay multas pendientes por ' + dinero(debe) + '. Deben pagarse en la biblioteca antes de pedir otro libro.');
                const tieneApartado = BD.reservas.some(r => r.libroId === libroId && r.lectorId === lectorId && r.aviso);
                if (libro.copias - prestadosDe(libroId) < 1) return fallo('No hay ejemplares disponibles de ese libro.');
                if (libro.copias - prestadosDe(libroId) - apartadosDe(libroId) + (tieneApartado ? 1 : 0) < 1) return fallo('Los ejemplares disponibles están apartados para lectores que reservaron antes.');
                const activos = BD.prestamos.filter(p => p.lectorId === lectorId && !p.devuelto);
                if (activos.length >= MAX_ACTIVOS) return fallo('El lector ya tiene 3 préstamos activos.');
                if (activos.some(p => p.libroId === libroId)) return fallo('El lector ya tiene este libro.');
                BD.prestamos.push({ id: BD.sig.prestamo++, libroId, lectorId, fecha: hoy(), limite: sumaDias(hoy(), dias), devuelto: null, renovado: false, multaPagada: false });
                BD.reservas = BD.reservas.filter(r => !(r.libroId === libroId && r.lectorId === lectorId));
                return ok('Préstamo registrado.');
            }
            const p = BD.prestamos.find(x => x.id === (Number(d.id) || 0));
            if (acc === 'devolver') {
                if (!p) return fallo('El préstamo no existe.', 404);
                if (!staff) return fallo('Solo el personal de la biblioteca puede registrar devoluciones.', 403);
                if (p.devuelto) return fallo('Ese préstamo ya fue devuelto.');
                p.devuelto = hoy();
                if (p.libroId !== null) procesarReservas(p.libroId);
                return ok('Devolución registrada.');
            }
            if (acc === 'renovar') {
                if (!p) return fallo('El préstamo no existe.', 404);
                if (!staff && p.lectorId !== u.id) return fallo('No tienes permiso para esta acción.', 403);
                if (p.devuelto) return fallo('Ese préstamo ya fue devuelto.');
                if (p.renovado) return fallo('Este préstamo ya fue renovado una vez.');
                if (p.limite < hoy()) return fallo('No se puede renovar un préstamo vencido.');
                const debe = p.lectorId !== null ? deuda(p.lectorId) : 0;
                if (debe > 0) return fallo('Hay multas pendientes por ' + dinero(debe) + '. Deben pagarse antes de renovar.');
                if (BD.reservas.some(r => r.libroId === p.libroId)) return fallo('No se puede renovar: otro lector reservó este libro.');
                p.limite = sumaDias(p.limite, DIAS_RENOVACION); p.renovado = true;
                return ok('Préstamo renovado 7 días.');
            }
            if (acc === 'cobrar') {
                if (!staff) return fallo('Solo el personal de la biblioteca puede cobrar multas.', 403);
                if (!p) return fallo('El préstamo no existe.', 404);
                if (!p.devuelto) return fallo('El libro aún no ha sido devuelto: la multa se cobra al devolverlo.');
                if (p.multaPagada) return fallo('Esa multa ya fue cobrada.');
                const monto = Math.max(0, difDias(p.devuelto, p.limite)) * MULTA;
                if (monto <= 0) return fallo('Ese préstamo no tiene multa.');
                p.multaPagada = true;
                return ok('Multa de ' + dinero(monto) + ' cobrada.');
            }
        },

        // ----- Reservas -----
        reservas(acc, d) {
            const u = usuarioActual(), e = exigir(u); if (e) return e;
            if (acc === 'crear') {
                if (u.rol !== 'lector') return fallo('Solo los lectores pueden reservar libros.', 403);
                const libroId = Number(d.libro) || 0, libro = BD.libros.find(l => l.id === libroId);
                if (!libro) return fallo('El libro no existe.', 404);
                if (BD.prestamos.some(p => p.libroId === libroId && p.lectorId === u.id && !p.devuelto)) return fallo('Ya tienes este libro prestado.');
                procesarReservas(libroId);
                if (libro.copias - prestadosDe(libroId) - apartadosDe(libroId) > 0) return fallo('Ese libro ya está disponible: puedes pedirlo prestado.');
                if (!BD.reservas.some(r => r.libroId === libroId && r.lectorId === u.id)) {
                    BD.reservas.push({ id: BD.sig.reserva++, libroId, lectorId: u.id, fecha: ahora(), aviso: null });
                }
                return ok('Reserva registrada. Te avisaremos en "Mis préstamos" cuando esté disponible.');
            }
            if (acc === 'cancelar') {
                const id = Number(d.id) || 0, r = BD.reservas.find(x => x.id === id);
                if (r && (u.rol !== 'lector' || r.lectorId === u.id)) {
                    BD.reservas = BD.reservas.filter(x => x.id !== id);
                    procesarReservas(r.libroId);
                }
                return ok('Reserva cancelada.');
            }
        },

        // ----- Usuarios (solo administrador) -----
        async usuarios(acc, d) {
            const u = usuarioActual(), e = exigir(u, 'admin'); if (e) return e;
            const id = Number(d.id) || 0, x = BD.usuarios.find(y => y.id === id);
            if (acc === 'crear') {
                const err = await crearUsuario(d, texto(d.rol));
                return err ? fallo(err) : ok('Usuario creado.');
            }
            if (acc === 'eliminar') {
                if (id === u.id) return fallo('No puedes eliminar tu propia cuenta.');
                if (!x) return fallo('El usuario ya no existe.', 404);
                if (BD.prestamos.some(p => p.lectorId === id && !p.devuelto)) return fallo('El usuario tiene préstamos activos.');
                BD.usuarios = BD.usuarios.filter(y => y.id !== id);
                BD.prestamos.forEach(p => { if (p.lectorId === id) p.lectorId = null; });
                BD.reservas = BD.reservas.filter(r => r.lectorId !== id);
                BD.solicitudes = BD.solicitudes.filter(s => s.usuarioId !== id);
                return ok('Usuario eliminado.');
            }
            if (acc === 'restablecer') {
                const pass = String(d.pass ?? '');
                if (id === u.id) return fallo('Para cambiar tu propia contraseña usa "Configurar perfil".');
                if (pass.length < 6) return fallo('La contraseña temporal debe tener al menos 6 caracteres.');
                if (!x) return fallo('El usuario ya no existe.', 404);
                x.hash = await hash(pass); x.debeCambiar = true;
                BD.solicitudes.forEach(s => { if (s.usuarioId === id) s.atendida = true; });
                return ok('Contraseña de ' + x.nombre + ' restablecida. Entrégale la contraseña temporal y pídele que la cambie en "Configurar perfil".');
            }
            if (acc === 'editar') {
                if (!x) return fallo('El usuario ya no existe.', 404);
                const nombre = texto(d.nombre), email = texto(d.email).toLowerCase(), nick = texto(d.usuario).toLowerCase();
                let rol = texto(d.rol);
                const cambiaNick = nick !== '' && nick !== x.usuario;
                if (cambiaNick) { const err = errorUsuario(nick, id); if (err) return fallo(err); }
                if (nombre.length < 2) return fallo('Escribe el nombre completo.');
                if (nombre.length > 100) return fallo('El nombre es demasiado largo (máximo 100 caracteres).');
                if (!correoValido(email) || email.length > 150) return fallo('El correo no es válido.');
                if (BD.usuarios.some(y => y.email === email && y.id !== id)) return fallo('Ese correo ya está en uso.');
                if (x.rol === 'admin' || id === u.id) rol = x.rol;
                if (!['lector', 'bibliotecario', 'admin'].includes(rol)) return fallo('Rol no válido.');
                if (rol !== x.rol) {
                    if (BD.prestamos.some(p => p.lectorId === id && !p.devuelto)) return fallo('No se puede cambiar el rol: el usuario tiene préstamos activos.');
                    x.rol = rol;
                }
                x.nombre = nombre; x.email = email; if (cambiaNick) x.usuario = nick;
                return ok('Usuario actualizado.');
            }
            if (acc === 'descartar') {
                const s = BD.solicitudes.find(y => y.id === id);
                if (s) s.atendida = true;
                return ok('Solicitud descartada.');
            }
        }
    };

    /* ==========================================================================
       PUNTO DE ENTRADA: lo usa app.js en lugar de fetch()
       ========================================================================== */
    window.api = async function (ruta, cuerpo) {
        try {
            if (!cargarBD()) await iniciar();
            const d = cuerpo || {};
            const r = (await RUTAS[ruta]?.(texto(d.accion), d)) ?? fallo('Acción no válida.');
            if (r.ok && ruta !== 'datos' && !guardarBD()) return fallo('No se pudo guardar en el navegador (almacenamiento lleno o bloqueado).', 500);
            if (r.ok && ruta === 'datos') guardarBD(); // Persiste los ajustes de reservas hechos al leer
            return r;
        } catch (err) {
            console.error(err);
            return fallo('Ocurrió un error inesperado.', 500);
        }
    };
})();
