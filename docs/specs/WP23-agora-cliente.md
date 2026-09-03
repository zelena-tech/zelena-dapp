# WP23 · Ágora abierta al cliente: el empresario publica y paga (Modo A)

CONTEXTO — La metodología de 8 pasos del manifiesto **ya asume un cliente que
paga**: Intake → Publicación → Aplicación → Asignación → Ejecución → Evaluación →
Distribución → Reputación. Y el modelo de datos ya está casi completo:
`projects` tiene `type` (SAS|DAO, inmutable tras intake), `budget_usd`,
`acceptance` y la máquina de estados `Open → Assigned → Delivered → Scored →
Distributed`; `milestones` tiene `pct`, `amount_usd` y `approved` — la estructura
20/70/10 del Modo A ya es representable.

Lo que falta no es el modelo: es **la puerta de entrada**. `INSERT INTO projects`
aparece hoy en un solo lugar de todo el código: `seed.ts`. No existe forma de
crear un proyecto desde la app, ni por UI ni por API. El Ágora es, hoy,
solo-lectura sobre datos sembrados.

PROBLEMA — El empresario que quiere algo desarrollado no tiene por dónde entrar.
Todo pasa por la agenda de John, que es el cuello de botella de la información y
de la venta. Cada proyecto vive en su cabeza y en WhatsApp, no en el sistema que
mide y remunera. Y sin `client_id` en `projects`, el trabajo pagado por un cliente
es indistinguible del trabajo interno.

RESULTADO ESPERADO — Un empresario entra con su correo, abre su espacio, describe
lo que necesita con presupuesto y criterios de aceptación, y sigue el avance sin
llamar a nadie. ZELENA cotiza, publica, asigna y ejecuta. Él aprueba hitos. La
factura sale de Odoo.

---

## Lo que esto NO es (y por qué la distinción importa)

Esto es un **contrato de prestación de servicios**: la SAS cotiza, entrega y
factura; el cliente paga por lo entregado. No hay promesa de rendimiento, no hay
intermediación de recursos ajenos, no hay producto financiero. **No requiere
autorización financiera ni gate regulatorio.** Es, literalmente, el negocio que
ZELENA ya opera — solo que hoy la intake es una reunión y aquí es un formulario.

La frontera que **sí** tiene gate está una capa más adelante:

| Escenario | Qué es | Gate |
|---|---|---|
| El cliente paga contra hito aprobado, factura de la SAS | Prestación de servicios. **Modo A. Este WP.** | Ninguno nuevo |
| ZELENA **retiene** el dinero del cliente hasta la entrega | Custodia de recursos de terceros | Plano 04: escrow, auditoría independiente + legal |
| El dinero del cliente se distribuye solo, on-chain, por score | **Modo B** | Los tres gates del plano 04 + WP10 |
| ZELENA recibe dinero del público ofreciendo un retorno | Captación (Art. 316 CP) | **No está en ningún roadmap.** No confundir con lo anterior |

Modo A evita el problema de custodia **por diseño**: no se retiene nada. Se
factura contra hito aprobado, como cualquier consultora.

**La única obligación real de Modo A** es tributaria, no regulatoria: retención en
la fuente por servicios al pagar a contribuidores independientes, y clasificación
correcta de la relación (servicios vs. laboral) para cada quien. Dueño: Juan
(FinOps/contratos). No bloquea construir; bloquea el primer pago — exactamente
igual que hoy, sin este WP.

---

## Alcance

### Modelo (deltas pequeños sobre lo que ya existe)
- `projects.client_id` → `clients.id` (WP17). Quién paga. Nullable: el trabajo
  interno y los proyectos DAO no tienen cliente.
- `projects.created_by` — quién lo originó (puede ser el propio cliente).
- Estado nuevo **`Draft`** antes de `Open`: el cliente crea en borrador; ZELENA
  cotiza (ajusta `budget_usd`, `weeks`, hitos) y **publica** pasándolo a `Open`.
  El cliente propone; ZELENA acepta el trabajo. Sin esto, cualquiera publicaría
  presupuestos que ZELENA no se comprometió a cumplir.
- `client_members.access_level` gana el nivel **`cliente`** (por debajo de
  `lectura`): ve SUS proyectos y su marca; no ve el grafo de operación, ni el
  inventario de accesos, ni otros clientes.
- `milestones.approved_by` + `approved_at` — **la aprobación del hito es del
  cliente**, no de ZELENA. Es su firma sobre el criterio de aceptación.

### Vistas
- `/clientes/[slug]?tab=proyectos` — sus proyectos, hitos, qué falta, qué aprobó.
- Formulario de intake: título, qué necesita, criterio de aceptación, presupuesto
  tentativo, fecha deseada. Crea en `Draft`.
- El Ágora existente (`/agora`) sigue mostrando los proyectos `Open` a los
  contribuidores. Un proyecto en `Draft` no aparece ahí.

### Puente con lo ya construido
- **Odoo hace la factura.** Frontera ya decidida en QUEUE: facturación,
  cotizaciones y contabilidad viven en Odoo, fuera de la dapp. La dapp guarda
  presupuesto por proyecto, hitos y aprobaciones; **jamás** datos financieros
  sensibles. Integración por referencia (`projects.odoo_ref`), nunca por copia.
- **El pago a contribuidores es WP10**, sin cambios: registro verificable, el
  pago se ejecuta fuera de la app.
- **La distribución por score es Harmony**, y aquí está el punto estratégico
  (abajo).

## NO-ALCANCE (explícito)

- Custodia o escrow del dinero del cliente dentro de la app → Modo B, plano 04.
- Pasarela de pagos en la dapp. La factura y el recaudo son de Odoo.
- Autoservicio público sin invitación. En v1 el cliente entra invitado, igual que
  todo lo demás.
- Que el cliente vea el grafo de operación (WP20), el inventario de credenciales
  o cualquier dato de otro cliente. El nivel `cliente` es el más restringido.
- Marketplace abierto de contribuidores externos → ver riesgo de arranque abajo.

## EL PUNTO ESTRATÉGICO: esto de-riesga Harmony

La auditoría de producto dejó a Harmony como hipótesis de alto riesgo por una
pregunta concreta: *¿pagarían las empresas por un producto dedicado de
incentivos?* Esa pregunta no se ha podido responder porque se intentaba vender
automatización de incentivos a dueños de bodega.

**En este modelo el cliente nunca compra Harmony.** El cliente compra desarrollo.
Harmony es cómo ZELENA le paga a quien lo hizo. Consecuencias:

1. **Desaparece la pregunta de disposición a pagar por Harmony.** Deja de ser un
   SKU y pasa a ser infraestructura interna de la que ZELENA depende.
2. **ZELENA es su propio primer cliente, con dinero real y a escala real.** El
   motor de scoring se valida sobre entregas que alguien pagó.
3. **Genera exactamente la evidencia que el gate exige:** "3 épocas cerradas con
   distribución real" deja de ser un piloto artificial y se vuelve la operación.
4. Para el SCF y para inversionistas, "lo usamos para pagarnos a nosotros" es una
   prueba más fuerte que cualquier carta de intención.

Esto no valida Harmony como producto de mercado — sigue sin estar validado que un
tercero pague por él. Valida algo distinto y más barato: que **funciona**.

## RIESGO DE ARRANQUE (el real, y no es legal ni técnico)

El manifiesto asume una comunidad de contribuidores lista para tomar proyectos
publicados. Hoy esa comunidad son las 6 personas del equipo. Si un empresario
publica una necesidad y quien la ejecuta son los mismos 6, esto no es un
marketplace: es un formulario de intake elegante. Hay que decirlo así.

La salida no es reclutar comunidad primero. Es la flota de agentes: un proyecto
publicado lo ejecuta **1 orquestador humano + agentes**, lo que permite honrar
demanda sin un pool grande de contribuidores. ZELENA cumple primero; la comunidad
cumple después, cuando haya volumen que justifique su entrada. Ese es el orden
correcto del arranque de dos lados.

## CRITERIOS DE ACEPTACIÓN

- [ ] Un cliente crea un proyecto en `Draft` y NO aparece en `/agora` (test).
- [ ] Solo un supervisor/founder puede pasar `Draft → Open` (test de permisos).
- [ ] Nivel `cliente` ve sus proyectos y NO ve el grafo de operación, el
  inventario de credenciales ni ningún otro cliente (test de API, no de UI).
- [ ] Aprobar un hito registra quién y cuándo; el cliente puede aprobar, ZELENA no
  puede aprobar en su nombre (test).
- [ ] `projects.client_id` nulo sigue funcionando: el trabajo interno y los
  proyectos DAO no se rompen (test de regresión).
- [ ] Cero campos financieros sensibles en el esquema: pasa
  `auditSchemaForSecretColumns` y la revisión de frontera con Odoo.

OWNER — Fausto (modelo + permisos) · David (intake y vista de cliente) ·
Juan (retención en la fuente y clasificación de contribuidores, antes del 1er pago) ·
Vale (valida los tests de permisos: es la superficie crítica).
TAMAÑO — M · Depende: WP17 (clients + RBAC), WP14 (asignaciones). Sin gate regulatorio.
