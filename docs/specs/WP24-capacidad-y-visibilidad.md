# WP24 · Asignación de capacidad y visibilidad del cliente (célula dedicada)

CONTEXTO — Idea de John: la plataforma como staffing. "X proyecto necesita un dev,
yo se lo asigno y puedo controlar sus avances según las asignaciones que tenga;
el empresario (o un rol asignado) entra y ve los avances por proyecto y por tarea."

Casi todo el motor existe: `assignments` con su máquina de estados, historial
append-only, `loadByPerson()` y límite de WIP personal (WP14); `clients` +
`client_members` con RBAC probado a nivel de datos (WP17); `projects` +
`milestones` con presupuesto y aprobación (WP23). **Falta una sola pieza de
modelo: la capacidad comprometida.** Hoy se sabe cuánto trabajo abierto tiene
alguien, pero no cuánta de su capacidad está vendida a quién ni hasta cuándo.

PROBLEMA — Sin capacidad comprometida no se puede responder "¿puedo tomar este
proyecto?" ni "¿a quién le queda espacio?". Y el cliente no tiene forma de ver el
avance sin preguntarle a John, que sigue siendo el cuello de botella.

RESULTADO ESPERADO — John compromete capacidad por perfil a un proyecto de
cliente con ventana de tiempo definida; el sistema impide sobrecomprometer; y el
cliente entra con su correo y ve avance por proyecto y por tarea, en solo lectura.

---

## ⚠ LA DECISIÓN QUE DEFINE EL MODELO (leer antes de diseñar la UI)

**En Colombia hay dos modelos con consecuencias legales muy distintas, y la
frontera pasa por una sola pregunta: ¿quién dirige al trabajador?**

| Modelo | Qué se vende | Quién dirige | Estatus |
|---|---|---|---|
| **Tercerización lícita** (prestación de servicios) | Un resultado / una capacidad de ZELENA | **ZELENA** asigna, prioriza y supervisa. El cliente ve y aprueba entregables | Lícito con autonomía e independencia (Art. 34 CST) |
| **Intermediación laboral** (envío de trabajadores en misión) | Personas | **El cliente** asigna tareas y supervisa el día a día | **Actividad reservada a Empresas de Servicios Temporales**, con autorización del Ministerio de Trabajo (Ley 50/1990 art. 71+, Decreto 4369/2006, hoy compilado en Decreto 1072/2015) |

Las EST además solo pueden contratarse por tres causales (labor ocasional ≤1 mes;
reemplazo por vacaciones/licencia/incapacidad; incremento de producción hasta 6
meses prorrogables 6 más). Fuera de eso, o sin autorización, la exposición es:
multas administrativas de hasta **5.000 SMMLV — con el salario mínimo 2026 eso es
del orden de COP 8.754 millones** — y, lo más grave, **reclasificación judicial de
los trabajadores como empleados directos del beneficiario**, con prestaciones y
perjuicios. Súmese la solidaridad laboral del Art. 34 CST, que hace responsable al
beneficiario por las obligaciones del contratista salvo que la labor sea extraña a
su giro ordinario.

**Por qué esto es un requisito de producto y no una nota al pie:** la función que
describiste — el cliente entra, ve tareas, y hay un dev asignado — cae justo sobre
la línea. La diferencia entre los dos modelos **se implementa en el RBAC**:

> **REGLA DE DISEÑO (no negociable en v1): el rol `cliente` es SOLO LECTURA sobre
> asignaciones.** Puede ver estado, avance y bloqueos. **No puede** crear tareas,
> asignarlas, reasignarlas, cambiar prioridad ni fijar fechas a una persona.
> Lo que sí puede: aprobar/rechazar **hitos** contra el criterio de aceptación
> (WP23) — eso es evaluar un entregable, no dirigir a un trabajador.

Si algún día se quiere que el cliente dirija tareas de una persona nombrada, eso
**no es un cambio de permisos: es un cambio de modelo de negocio** y exige
concepto de un abogado laboralista antes de escribir la primera línea.

> No soy abogado. Esto es el mapa de por qué el diseño importa y qué preguntar —
> no un concepto jurídico. La consulta con laboralista es **distinta** de la
> tributaria que ya tiene Juan (retención en la fuente, WP23): esa es DIAN, esta
> es Ministerio de Trabajo.

## Tres decisiones de diseño que empujan al lado seguro

1. **Se compromete un PERFIL, no una persona, ante el cliente.** El cliente
   contrata "capacidad de backend, 50%, 3 meses". Quién la cubre lo decide
   ZELENA y puede rotar. Internamente sí se sabe quién es.
2. **`ends_on` es obligatorio.** Un puesto abierto e indefinido sobre la actividad
   misional permanente del cliente es la forma de mayor riesgo. Forzar fecha de
   fin convierte la renovación en una decisión explícita, no en deriva.
3. **Guarda de sobreasignación (suma de % ≤ 100 por persona y ventana).** Además
   de ser útil operativamente, es **evidencia de que ZELENA administra la
   capacidad de su propia gente** — un indicador de subordinación a favor de
   ZELENA, igual que el límite de WIP y `loadByPerson` que ya existen.

---

## Alcance

### Modelo (una tabla nueva)
```
allocations: wallet, client_id, project_id (nullable), profile ('backend'|'frontend'|
             'datos'|'qa'|'ops'|'analista'), pct (10..100), starts_on, ends_on (NOT NULL),
             created_by, notes
```
- Función pura `validarAsignacion()`: `pct` en rango, ventana válida (`ends_on >
  starts_on`), y **suma de `pct` de ventanas solapadas ≤ 100** por persona.
- `assignments.allocation_id` (nullable) para atribuir trabajo a una capacidad
  comprometida y poder medir consumo real vs. vendido.

### Vistas
- **`/equipo/capacidad`** (interno): matriz persona × semana con % comprometido,
  quién tiene espacio, qué vence pronto. Mide cargas, jamás "rendimiento".
- **`/clientes/[slug]?tab=avance`** (rol `cliente`): por proyecto → hitos, tareas
  con estado, qué está bloqueado y por qué. **Sin nombres de personas por
  defecto** (perfil, no persona); sin botones de acción; sin fechas editables.
- Consumo vs. comprometido por proyecto: la métrica que sostiene la renovación.

### Rol `cliente` (extiende WP17/WP23)
Nivel más restringido de `client_members`. Ve: sus proyectos, hitos, avance de
tareas, su marca. **No ve:** el grafo de operación (WP20), el inventario de
credenciales, la capacidad del equipo, ningún otro cliente, ni el nombre de quién
ejecuta salvo que ZELENA lo habilite explícitamente por proyecto.

## NO-ALCANCE

- **Que el cliente cree, asigne o repriorice tareas.** Ver la regla de diseño.
- **Timesheets / horas facturables.** Se vende capacidad y resultado, no horas.
  Registrar horas por persona para facturarlas al cliente es, además, el rastro
  documental típico de la intermediación.
- Vender personas nombradas por hora → cambio de modelo, requiere laboralista.
- Nómina y pagos → WP10.
- Facturación → Odoo (frontera ya decidida).

---

## LA TENSIÓN ESTRATÉGICA QUE HAY QUE NOMBRAR

Staffing por persona-mes es el único modelo de precio donde **la flota de agentes
te hace ganar menos**. Si vendes "un dev a $X/mes", el ingreso escala con
headcount: es exactamente la economía que la estrategia de ZELENA argumenta
abandonar (Garry Tan: "no contrates, redefine"). Y si 1 humano + agentes entrega
lo de 3, cobrar 3 devs no es apalancamiento: es facturar gente que no está.

Pero el staffing tiene una virtud real que no hay que despreciar: **se vende
mucho más fácil.** "Necesito un dev" es una decisión de compra simple y recurrente;
"cotíceme este proyecto" exige que el cliente sepa lo que quiere.

La salida no es elegir uno. Es el modelo intermedio:

> **Célula dedicada.** El cliente compra una capacidad comprometida con alcance
> definido por período (entregables por sprint/mes), a precio fijo mensual.
> ZELENA decide internamente si eso es 1 humano + agentes o 2 humanos.

Eso te da lo mejor de los dos: se vende como staffing (predecible, recurrente,
fácil de aprobar), se ejecuta como resultado (la flota es margen legítimo, no
facturación inflada), y **legalmente es tercerización** porque ZELENA dirige y
entrega. Es también el shape que hace que el grafo de operación (WP20) se venda
solo: la célula dedicada rinde más en el cliente cuyo contexto ya está mapeado.

## CRITERIOS DE ACEPTACIÓN

- [ ] `validarAsignacion()` rechaza sobreasignar (85% + 30% solapados → error), con
  tabla de casos borde: ventanas adyacentes no solapan, ventana de un día, fin
  antes de inicio.
- [ ] `ends_on` nulo se rechaza a nivel de función, no solo de UI.
- [ ] **El rol `cliente` recibe 403/404 en TODA escritura sobre `assignments`**
  (test de API por cada acción de la máquina de estados, no de UI). Este test es
  el que materializa la frontera legal: si se cae, el modelo cambió.
- [ ] El rol `cliente` no ve `/equipo/capacidad` ni nombres de ejecutores por
  defecto (test).
- [ ] El cliente SÍ puede aprobar/rechazar un hito y queda registrado quién y
  cuándo (test).
- [ ] Consumo vs. comprometido por proyecto cuadra con las asignaciones cerradas.

OWNER — Fausto (modelo + permisos) · David (vistas de capacidad y avance) ·
Vale (dueña de los tests de permisos: aquí son la frontera legal, no un detalle) ·
**John: agendar concepto con abogado laboralista antes del primer contrato de
célula dedicada.** Es un gate comercial, no técnico: no bloquea construir.
TAMAÑO — M · Depende: WP14, WP17, WP23.

Fuentes consultadas (2026-08-17): Decreto 4369 de 2006 (Función Pública) ·
Decreto 583 de 2016 · Art. 34 CST · análisis de tercerización vs. intermediación.
