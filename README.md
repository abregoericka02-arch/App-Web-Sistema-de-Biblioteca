# Sistema de Biblioteca (HTML, CSS y JavaScript)

Versión web que usa solo HTML, CSS y JavaScript. No necesita PHP, MySQL ni XAMPP.

## Cómo abrirla
- Doble clic en `index.html`, o
- En VS Code, clic derecho sobre `index.html` > **Open with Live Server**.

## Usuarios de prueba
| Rol           | Usuario | Contraseña |
|---------------|---------|------------|
| Administrador | admin   | admin123   |
| Bibliotecario | biblio  | biblio123  |
| Lector        | lector  | lector123  |

## Archivos
- `index.html`: estructura de la página (menú, zona central, pie y ventana de detalle).
- `css/estilos.css`: colores, tarjetas, tablas, menú adaptable y modo oscuro.
- `js/semilla.js`: datos iniciales de ejemplo (categorías y 6 libros).
- `js/almacen.js`: guarda los datos en `localStorage` y aplica las reglas (préstamos, multas, reservas, roles y validaciones).
- `js/app.js`: dibuja las pantallas y responde a las acciones del usuario.

## Cosas a tener en cuenta
- Los datos se guardan en el navegador donde se usa la aplicación. Si se borran los datos del sitio, vuelven los datos de ejemplo.
- Las contraseñas se guardan con una huella SHA-256, no en texto plano.
- Al restablecer una contraseña, el administrador ve un enlace «Escribir al correo» que abre su programa de correo con la clave temporal ya escrita.
- Para reiniciar todo: abrir la consola del navegador y ejecutar `localStorage.clear()`.
