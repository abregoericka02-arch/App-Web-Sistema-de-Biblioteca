/* Datos iniciales de ejemplo: se cargan una sola vez, la primera vez que se abre la aplicación. */
const SEMILLA = {
  categorias: ["Literatura", "Tecnología", "Ciencia", "Infantil", "Historia", "Otros"],
  libros: [
  {
    "id": 1,
    "categoria": "Literatura",
    "titulo": "Cien años de soledad",
    "autor": "Gabriel García Márquez",
    "isbn": "LIB-001",
    "anio": 1967,
    "copias": 3,
    "descripcion": "Novela del realismo mágico que narra la historia de la familia Buendía a lo largo de siete generaciones en el pueblo ficticio de Macondo.",
    "portada": "assets/img/covers/libro_1.jpg"
  },
  {
    "id": 2,
    "categoria": "Literatura",
    "titulo": "Don Quijote de la Mancha",
    "autor": "Miguel de Cervantes",
    "isbn": "LIB-002",
    "anio": 1605,
    "copias": 2,
    "descripcion": "Un hidalgo que enloquece de tanto leer libros de caballerías decide hacerse caballero andante y sale al camino con su escudero Sancho Panza. Es una de las obras cumbre de la literatura en español.",
    "portada": "assets/img/covers/libro_2.jpg"
  },
  {
    "id": 3,
    "categoria": "Tecnología",
    "titulo": "Fundamentos de Programación",
    "autor": "Luis Joyanes",
    "isbn": "LIB-003",
    "anio": 2008,
    "copias": 2,
    "descripcion": "Libro de texto que introduce los conceptos básicos de la programación: algoritmos, estructuras de datos y diseño de programas.",
    "portada": "assets/img/covers/libro_3.jpg"
  },
  {
    "id": 4,
    "categoria": "Tecnología",
    "titulo": "Clean Code",
    "autor": "Robert C. Martin",
    "isbn": "LIB-004",
    "anio": 2008,
    "copias": 2,
    "descripcion": "Guía de buenas prácticas para escribir código legible, ordenado y fácil de mantener, con ejemplos de refactorización.",
    "portada": null
  },
  {
    "id": 5,
    "categoria": "Ciencia",
    "titulo": "Breve historia del tiempo",
    "autor": "Stephen Hawking",
    "isbn": "LIB-005",
    "anio": 1988,
    "copias": 2,
    "descripcion": "Obra de divulgación científica sobre el origen y la estructura del universo, los agujeros negros y la naturaleza del tiempo, escrita para lectores sin formación en física.",
    "portada": null
  },
  {
    "id": 6,
    "categoria": "Infantil",
    "titulo": "El principito",
    "autor": "Antoine de Saint-Exupéry",
    "isbn": "LIB-006",
    "anio": 1943,
    "copias": 3,
    "descripcion": "Cuento sobre un pequeño príncipe que viaja por distintos planetas y reflexiona sobre la amistad, el amor y la forma en que los adultos ven el mundo.",
    "portada": "assets/img/covers/libro_6.jpg"
  }
]
};
