/**
 * El método en ocho pasos (WP31-E1), en lenguaje llano. Lo usan /metodo y la
 * bienvenida de /entrar. Puro y apto para cliente.
 *
 * Primero lo real: el paso 7 dice qué corre hoy en la red de pruebas y qué se
 * paga por fuera contra el hito aprobado.
 */
export const PASOS_METODO: ReadonlyArray<{ n: string; titulo: string; texto: string }> = [
  {
    n: "01",
    titulo: "Llega una necesidad.",
    texto:
      "Una empresa o la comunidad trae un problema real. Se define qué hay que entregar, cuánto vale y cómo se va a evaluar.",
  },
  {
    n: "02",
    titulo: "Se publica.",
    texto: "El proyecto se abre con su alcance, sus hitos y su forma de evaluación, a la vista de todos.",
  },
  {
    n: "03",
    titulo: "Aplicas con tu enfoque.",
    texto:
      "No hay puja por precio: cuentas cómo lo resolverías, en qué tiempo y cómo sabremos que salió bien.",
  },
  {
    n: "04",
    titulo: "Se elige quién lo hace.",
    texto: "Por el enfoque y el historial. El motivo queda escrito.",
  },
  {
    n: "05",
    titulo: "Construyes por hitos.",
    texto: "El trabajo se parte en entregas cortas; la primera llega en una o dos semanas.",
  },
  {
    n: "06",
    titulo: "Otra persona revisa la entrega.",
    texto: "Contra el criterio acordado. Se califica la entrega, nunca a la persona.",
  },
  {
    n: "07",
    titulo: "Se paga el hito.",
    texto:
      "Cada hito aprobado se paga. Los pagos que ves dentro de la plataforma corren hoy en la red de pruebas de Stellar; cuando hay un pago real, se hace por fuera contra el hito aprobado y aquí queda el registro.",
  },
  {
    n: "08",
    titulo: "Tu historial crece.",
    texto: "Lo que entregaste queda registrado a tu nombre. No se borra y no se quita.",
  },
];
