# Whitepaper — Zelena DAO

Versión 1 · Julio de 2026 · Documento público del repositorio open source

> Este documento describe el diseño de la comunidad Zelena DAO y su relación con Zelena SAS. No es una oferta de valores, ni asesoría legal, financiera o de inversión. Todo lo aquí descrito corre hoy en **testnet**; el paso a mainnet está condicionado a auditoría, acuerdo de anchor y clasificación legal de los pagos. Muchas de las mecánicas están en fase de validación con una cohorte pequeña antes de codificarse en contratos.

---

## 1. Resumen

Zelena es una firma de gestión de activos digitales que ayuda a pequeñas y medianas empresas (SMEs) de América Latina a atravesar la disrupción tecnológica. Opera como una comunidad de contribuidores —no de empleados— donde el valor entregado, y no el cargo ni la antigüedad, determina el reconocimiento y la recompensa.

Este whitepaper describe la **Zelena DAO**: la capa comunitaria y de gobernanza del ecosistema. La DAO se articula sobre una arquitectura de dos entidades. Una sociedad (**Zelena SAS**) es titular de la propiedad intelectual y de los ingresos; una comunidad gobernada (**Zelena DAO**) coordina el trabajo, mide el valor y acumula reputación. Un acuerdo de servicios une a ambas.

El documento distingue con cuidado entre lo que ya está validado, lo que es hipótesis y lo que aún no existe. El producto validado es la **Capa 1: WMS** (sistema de gestión de bodega), adoptado orgánicamente por unas diez empresas en Colombia. La capa de incentivos on-chain (**Harmony**) es una hipótesis en validación, no un producto con encaje de mercado confirmado. La misma disciplina aplica a la DAO: primero se valida la **cooperación** de una cohorte real; solo después se invierte en tokenomics líquida, mainnet o gobernanza compleja.

El corazón económico del modelo es un **triángulo de tres activos**, cada uno con un rol único: **USDC** paga el trabajo, la **reputación** otorga voto y acceso, y **ZWORK** representa un derecho residual sobre el éxito del ecosistema. Ninguno sustituye a otro.

---

## 2. El problema

Dos problemas se cruzan en el mismo lugar.

**Las SMEs de LATAM operan a ciegas.** Cerca del 70% de las pequeñas y medianas empresas de la región funcionan sin ningún sistema de gestión. El dueño coordina con papel, WhatsApp y Excel. No hay visibilidad en tiempo real ni procesos digitalizados. En logística, la rotación del personal de bodega alcanza el 49% anual, y reemplazar a un operario cuesta entre tres y seis meses de productividad. Los aumentos de salario mínimo del 18–25% en varios países de la región entre 2023 y 2025 convirtieron la retención en un problema de supervivencia financiera.

**El trabajo real no se reconoce.** El operario recibe un salario fijo sin importar su desempeño. Los sistemas de incentivos existentes son manuales, inconsistentes y a menudo abandonados. La misma lógica se repite hacia adentro de las organizaciones de conocimiento: quien aporta valor —código, investigación, diseño, contenido— rara vez tiene un registro portátil, verificable e inmutable de lo que hizo. Su reputación vive en un CV que nadie puede auditar.

Zelena parte de una creencia central: **el valor que entregas debería determinar lo que recibes.** No el título, no la antigüedad, no las horas registradas. Lo que realmente produces.

---

## 3. Zelena hoy: WMS validado y la hipótesis Harmony

### 3.1 Capa 1 — WMS (validado)

El **Fulfillment Management System** es un sistema de gestión logística de extremo a extremo que controla el ciclo completo de fulfillment desde una sola plataforma. Nació resolviendo un problema real de un cliente real. Hoy tiene alrededor de diez clientes en producción en Colombia, todos por recomendación boca a boca, con cero inversión en publicidad y sin capital externo.

El WMS cubre once módulos (autenticación con roles, productos, órdenes, picking optimizado por ruta, packing, ubicaciones, recepción, reportes de avería, métricas de desempeño, facturación y traslados). El módulo de **métricas de desempeño** es el activo estratégico más fuerte: Zelena ya es dueña de los datos donde se mide el desempeño, lo que crea el derecho natural a extenderse hacia la compensación.

**Estatus:** problema real y validado. Demanda clara y confirmada.

### 3.2 Capa 2 — Harmony (hipótesis en validación)

**Harmony** es un sistema de recompensas on-chain que conecta el desempeño real del operario con pagos verificables, transparentes y automáticos en moneda local, construido sobre Stellar/Soroban. El operario nunca sabe que interactúa con una blockchain.

Harmony **no es un producto con encaje de mercado confirmado.** Una auditoría externa estableció que la fricción del incentivo manual es observada pero **no está validada como un dolor prioritario que las empresas paguen por automatizar.** No se sabe aún si las empresas pagarían por un producto dedicado, si Harmony es un producto independiente o una función del WMS, ni si existe la confianza suficiente para delegar el cálculo de pagos. La solución puede estar más desarrollada que validado el problema.

Por eso la prioridad presente es **validación, no infraestructura.** Este whitepaper trata a Harmony como una hipótesis sólida, respaldada por un posicionamiento fuerte, nunca como un hecho de mercado.

### 3.3 Cómo esto encuadra a la DAO

La misma infraestructura de desempeño verificado que paga a un operario de bodega puede pagar a los desarrolladores, diseñadores y analistas que construyen los productos de Zelena. La DAO es la aplicación interna de esa tesis: una comunidad donde el valor se mide y se recompensa con las mismas reglas. Y del mismo modo que Harmony se valida antes de escalar, la DAO valida su cooperación antes de codificar tokenomics compleja.

---

## 4. La DAO: tesis y arquitectura SAS + DAO

### 4.1 Tesis

La descentralización total desde el día uno es una fantasía costosa. La DAO se construye por etapas: **la descentralización es la recompensa de la madurez, no el punto de partida.** El objetivo del diseño no es sólo repartir poder, sino diseñar la cooperación cotidiana: por qué alguien llega, por qué vuelve mañana, y por qué el sistema sigue siendo honesto cuando nadie mira.

### 4.2 Dos entidades, un acuerdo

La arquitectura sigue un patrón inspirado en el modelo UNIfication: separar la entidad que sostiene el valor legal de la comunidad que lo coordina.

| Entidad | Rol | Es dueña de |
|---|---|---|
| **Zelena SAS** | Empresa formal | Marca, propiedad intelectual comercial, ingresos, relación con clientes |
| **Zelena DAO** | Comunidad gobernada | Coordinación del trabajo, reputación on-chain, token ZWORK, gobernanza |
| **Acuerdo de servicios** | Conector | Une a ambas: la DAO presta servicios, la SAS remunera y comercializa |

Esta separación protege a los contribuidores (la responsabilidad legal recae en la SAS), da a los clientes una contraparte con la que contratar, y permite que la comunidad crezca sin cargar con obligaciones societarias individuales. Firmar el CLA o recibir reputación o ZWORK **no crea relación laboral ni societaria**, y esos activos no constituyen salario.

---

## 5. Metodología 8-Step y el Ágora

Todo proyecto —de un cliente externo o interno del ecosistema— recorre un flujo de colaboración de ocho pasos. El espacio donde este flujo ocurre es el **Ágora**, el tablero público de proyectos y bounties de la Dapp.

| Paso | Nombre | Descripción |
|---|---|---|
| 01 | Intake | Llega la necesidad. El core team diagnostica, define alcance, entregables, presupuesto, plazo y criterios de evaluación en un PRD. Aquí se **etiqueta la PI como Cliente/SAS o Comunidad/DAO.** |
| 02 | Publicación | El PRD se publica al Ágora con habilidades requeridas, criterios de aceptación y cómo se medirá el valor. |
| 03 | Aplicación | Contribuidores con las competencias adecuadas aplican, presentando su enfoque y su historial en Zelena (score, proyectos, especialidades). |
| 04 | Asignación | Un supervisor arma el equipo y abre un periodo de trabajo (máquina de estados: Open → Assigned → Delivered → Scored → Distributed). |
| 05 | Ejecución | El equipo ejecuta con entregas parciales y visibilidad en tiempo real. El motor de scoring mide calidad, cumplimiento de plazos, complejidad y colaboración. |
| 06 | Evaluación | El supervisor cierra el periodo. Se genera un score compuesto por contribuidor: calculado, transparente, verificable, no subjetivo. |
| 07 | Distribución | El presupuesto se reparte proporcional al score. El backend publica un merkle root en Soroban, el contrato verifica on-chain y se distribuye. |
| 08 | Reputación | Cada proyecto alimenta el perfil on-chain del contribuidor. Más historial habilita mejores proyectos. |

**El flywheel:** un cliente necesita algo → Zelena publica al Ágora → los contribuidores aplican → el equipo ejecuta → el valor se mide → las recompensas se reparten proporcionalmente → la reputación se acumula → llegan más clientes. Cada vuelta produce contribuidores con más historial, más productos internos y más clientes atraídos por resultados.

Para que el flywheel arranque —cuando aún no hay suficientes proyectos pagos— existe una **biblioteca de bounties internos siempre disponible** (mejoras a la Dapp, research, contenido, traducciones) y una **"primera misión" guiada de menos de dos horas** que termina en el primer punto de reputación el mismo día. El valor individual precede al colectivo.

---

## 6. Reputación: cuatro ejes y perfil on-chain

La reputación es el activo de coordinación de la DAO. No se compra, no se transfiere, y se gana entregando valor. El perfil de cada contribuidor es un historial **append-only**, anclado on-chain, organizado en cuatro ejes:

- **Ejecución** — calidad y cumplimiento en la entrega de trabajo.
- **Investigación / Contenido** — aportes de conocimiento, análisis, documentación.
- **Construcción de comunidad** — charlas, asistencia, mentoría y referidos que se activan.
- **Gobernanza** — propuestas presentadas, votos emitidos y participación sostenida en el tiempo.

El estatus solo motiva si es visible y ceremonial. Por eso los niveles llevan **nombre propio y ceremonia**: las promociones se anuncian en el demo day, y el perfil muestra insignias por eje (por ejemplo, un título real para "quien más investiga"). El estatus es la moneda más barata que la DAO puede emitir y su retorno sociológico es alto.

El árbol de invitaciones es visible on-chain para los guardianes. Sirve tanto para detectar ataques Sybil como para **mezclar equipos** cruzando ramas del árbol, evitando que cada invitador forme un clan cerrado que capture votos o coluda scores.

---

## 7. Tokenomics: el triángulo USDC / Reputación / ZWORK

El error que este diseño evita explícitamente es un token que sea "ownership de nada". Una recompensa que se percibe vacía es peor que ninguna: destruye la confianza en todo el sistema. Por eso se separan tres activos, cada uno con un único rol.

| Activo | Rol único | Propiedades |
|---|---|---|
| **USDC** | Pago por el trabajo (proyectos cliente/SAS) | Líquido. Sale del 70% del split del proyecto. |
| **Reputación** | Voto + acceso (proyectos grandes, guardianía) | No transferible. Con decaimiento para el peso de gobernanza. |
| **ZWORK** | Ownership: derecho residual sobre el éxito del ecosistema | **Puntos NO transferibles en la fase actual.** Derecho a participar de la regalía de licencia dual que la SAS paga al treasury. |

### 7.1 ZWORK: qué es y qué no es hoy

ZWORK es, **en la fase actual, un conjunto de puntos no transferibles.** No se puede vender, comprar ni intercambiar. La transferibilidad futura es posible **solo por decisión de gobernanza y previa revisión legal y tributaria** — nunca por defecto. Esta declaración explícita evita generar expectativa de inversión (con los riesgos regulatorios asociados), evita dinámicas de "farm-and-dump", y permite calibrar la emisión con datos reales antes de que exista precio.

El derecho estructural que ZWORK representa es concreto: cuando la SAS comercializa código de repositorio público (DAO), paga una **regalía al treasury** bajo la licencia dual (ver sección 9). Esa regalía puede distribuirse pro-rata a los holders con vesting cumplido. Fuentes de demanda estructural, sin especulación: (a) participación en la regalía SAS→treasury; (b) recompras de ZWORK que la gobernanza decida hacer; (c) staking de ZWORK como fianza para publicar propuestas al Ágora, que se pierde si la propuesta es spam.

### 7.2 Política de emisión por época

Cada score no puede emitir ZWORK sin límite: la dilución sin control destruiría a los contribuidores tempranos. Por eso la emisión sigue un **presupuesto por época** (por ejemplo trimestral), aprobado por gobernanza, con techo duro por época y un hard cap total o una cola de emisión decreciente. En el Milestone 1, la época única tiene un presupuesto fijo (propuesta: 100.000 puntos para 12 semanas, distribuidos solo vía score), publicado en el decision log antes del primer bounty.

### 7.3 Vesting comunitario

El ZWORK ganado **vestea en 6 a 12 meses de actividad continua.** Quien abandona a mitad de vesting deja valor en la mesa. Esto alinea horizontes, refuerza la salida ordenada y convierte la contribución en un juego repetido, no en un episodio único.

### 7.4 Retroactividad génesis

Contribuir hoy —en testnet, sin token líquido, sin regalías— podría parecer una estrategia perdedora frente a esperar a que la DAO madure. Si todos esperan, nadie contribuye. Para romper ese equilibrio de espera existe un **compromiso retroactivo escrito y anclado on-chain**: el score acumulado por la cohorte génesis desde el día 1 cuenta para cualquier asignación futura de ZWORK, proporcional al historial. No se promete precio; se promete **memoria.** El score de hoy cuenta para siempre, lo que convierte "esperar" en estrategia dominada.

---

## 8. Gobernanza: stages, guardianes, umbrales

### 8.1 Descentralización por etapas (Stage 0 → 4)

El poder se transfiere de forma gradual y condicionada a la madurez de la comunidad. En **Stage 0–1**, el founder concentra el poder por diseño; el riesgo no es el poder sino la opacidad. Por eso se acompaña de un **decision log público**: cada decisión fundacional (parámetro, veto, asignación) se registra en la Dapp con dos líneas de razón, anclada por hash. La comunidad acepta la autoridad que se explica. Etapas posteriores (2 → 4) amplían el poder efectivo de la comunidad conforme se cumplen criterios de participación y competencia.

### 8.2 Voto por reputación, no por token

Se vota por **reputación, no por token.** Esto impide comprar votos. Pero la reputación acumulada eterna produciría gerontocracia: veteranos que dominan aunque ya no aporten. Por eso el **peso de voto usa reputación con decaimiento** (ventana móvil de 12–18 meses de actividad), mientras el perfil histórico se conserva intacto como hoja de vida. Gobiernan los presentes; el historial honra a quienes estuvieron. Se añaden quórum mínimo y delegación por eje para combatir la apatía.

### 8.3 Guardianes

Los guardianes resuelven disputas y filtran propuestas. Para que no sean un punto único de falla:

- **Mandatos a término** de 12 meses, renovables por reputación (no vitalicios).
- **Revocación** por propuesta con umbral crítico.
- **Tope de invitaciones también para Gold/Guardián**, para cerrar el vector de captura más barato (un guardián desertor poblando la DAO con su clan).
- **Score de supervisión**: la calidad de sus evaluaciones alimenta su propio eje de reputación.

### 8.4 Umbrales, multisig y timelock

| Tipo de decisión | Umbral |
|---|---|
| Normal | 50% |
| Crítica | 66% |

Las operaciones sensibles pasan por **multisig + timelock**, dando tiempo de reacción ante propuestas maliciosas y evitando capturas de gobernanza tipo "flash".

### 8.5 Integridad del scoring

Como el supervisor cobra un porcentaje del proyecto y a la vez emite scores, existe incentivo a inflar los de sus aliados. Tres candados lo contienen: **revisión cruzada aleatoria** (un porcentaje de los cierres se re-evalúa por otro guardián sorteado — 10% al inicio, escalable a 25% si suben las disputas); la regla de que **un supervisor no evalúa a su invitado directo**; y el ya citado **score de supervisión**. Quien infla, pierde lo que más le costó ganar.

### 8.6 Otros mecanismos comunitarios

- **Calendario ritual** desde el génesis: sync semanal (30 min), demo day quincenal, retro mensual pública. El proof-of-attendance por QR es el motor de asistencia de estos ritos.
- **Estatus alumni**: quien se va no pierde su reputación; se congela y puede reactivarse al volver. La salida ordenada (traspaso de contexto) otorga un cierre positivo. Reduce el costo de irse bien y el incentivo de irse mal.
- **Mantenimiento del bien público**: el repositorio DAO no paga regalías, así que su mantenimiento se financia con una **línea explícita del treasury** (rol rotativo de maintainer remunerado por época). El jardín común necesita jardinero asalariado, no voluntario heroico.

---

## 9. Propiedad intelectual y open source

### 9.1 Clasificación de la PI en el intake

Cada proyecto se etiqueta desde el paso 01 (Intake) como uno de dos tipos:

- **Cliente / SAS** → repositorio **privado**. PI comercial de la SAS.
- **Comunidad / DAO** → repositorio **público open source**, custodiado por la SAS a nombre del DAO.

### 9.2 Licencia dual y regalía al treasury

El código Comunidad/DAO vive bajo una **licencia dual**: es open source para la comunidad, pero si la **SAS lo comercializa, paga una regalía al treasury** del DAO. Así se proyecta el ecosistema hacia el open source sin regalar la PI antes de tiempo, y se crea la fuente de flujo que da sustancia a ZWORK (sección 7.1). Hoy el repositorio arranca con una licencia *source-available* + CLA; abrir a una licencia más permisiva es una decisión de gobernanza posterior.

### 9.3 CLA obligatorio anclado on-chain

El onboarding es **por invitación** (código de un solo uso, ligado a la wallet del invitador, con expiración y tope por tier). Toda contribución exige **firmar el CLA antes del primer aporte**: se ceden los derechos patrimoniales a Zelena SAS, se respetan los derechos morales (inalienables), y el contribuidor se identifica por su wallet pública de Stellar, pudiendo **anclar el hash de la firma on-chain**. Sin CLA firmado, los PRs no se fusionan. El consentimiento de tratamiento de datos (Habeas Data) se integra al flujo de firma.

---

## 10. Infraestructura

Zelena se construye sobre **Stellar / Soroban**, elegida por razones alineadas con su caso de uso: liquidación en moneda local vía red de anchors (SEP-24), wallets no custodiales con passkey y recuperación sin frase semilla (SEP-30), KYC reutilizable (SEP-12), autenticación por cuenta (SEP-10), comisiones sub-céntimo que hacen viable el micro-pago por operario, y desembolsos por lote mediante la Stellar Disbursement Platform.

La Dapp es una aplicación de navegador (Next.js) donde las personas conectan su wallet (Freighter primero; passkey como spike en paralelo), ven proyectos, aplican, acumulan reputación y votan, **sin fricción cripto.** Los contratos Soroban (Rust/WASM) incluyen el token ZWORK y el treasury.

**Privacidad de pagos:** los cierres de periodo publican un **merkle root** en Soroban, de modo que la distribución es auditable sin exponer montos individuales en claro. El diseño contempla **Stellar Private Payments** (tecnología tipo X-Ray, pruebas ZK Groth16) para preservar la privacidad de los pagos manteniendo la verificabilidad.

**Todo corre hoy en testnet.** El paso a mainnet está condicionado a auditoría independiente de contratos, acuerdo comercial de anchor y clasificación legal de los pagos como bonos de desempeño (no salario).

---

## 11. Roadmap

### 11.1 Milestone 1 — "Génesis" (12 semanas, testnet)

El primer milestone no es un producto: es la **primera vuelta completa del flywheel con humanos reales.** Se valida que una persona invitada pueda entrar por la puerta diseñada (invitación → wallet → CLA → primer bounty), ejecutar, ser medida, recibir reputación y puntos, y **volver la semana siguiente.** La retención de la cohorte es la métrica reina.

Cuatro workstreams: **Dapp v0.1** en testnet (onboarding, Ágora, perfil, puntos ZWORK v0, decision log, repo público desde el día 1); **cohorte génesis** de 15–25 invitados curados con compromiso retroactivo anclado y biblioteca de bounties llena; **gobernanza mínima viable** (2–3 guardianes seed, primera votación real para ratificar el Reglamento v2, revisión cruzada activa); y **legal/IP en paralelo** (constitución de la SAS, marca, CLA publicado, cesiones de los devs actuales).

Criterios de éxito clave: ≥15 contribuidores con CLA anclado, ≥10 bounties completados y distribuidos, **≥60% de retención a 8 semanas**, ≥3 periodos cerrados con merkle root, ≥3 PRs externos merged bajo CLA-check. La regla de decisión es explícita: si la retención cae por debajo del 30%, se **detiene la construcción** — el problema sería la propuesta de valor al contribuidor, no la Dapp.

Lo que **NO** está en este milestone, a propósito: mainnet, dinero real, USDC, anchors, ZWORK transferible, auditoría de contratos, app móvil, puente WMS→Soroban y cualquier integración externa. Todo eso pertenece a fases posteriores y solo se justifica si la retención y la ejecución pasan.

### 11.2 Horizontes posteriores

Condicionados a la validación de la fase anterior: scoring on-chain completo, spike de passkey a producción, preparación de la aplicación al Stellar Community Fund, primer settlement real en mainnet tras auditoría, y expansión gradual de la gobernanza a lo largo de los stages. Ninguna promesa de fecha ni de valor: cada horizonte es una hipótesis que la comunidad valida antes de invertir en la siguiente.

---

## 12. Riesgos

Este diseño se presenta con sus debilidades a la vista.

- **Riesgo regulatorio.** La clasificación legal de ZWORK y de los pagos de recompensa no está resuelta. La transferibilidad de ZWORK o el tratamiento de la regalía podrían activar marcos de valores (tipo Howey u homólogos locales). Nada se mueve a mainnet ni a transferibilidad sin abogado y asesor tributario.
- **Riesgo de validación de demanda.** La hipótesis Harmony —y, análogamente, la propuesta de valor al contribuidor de la DAO— puede no sostenerse. Lo observado es fricción, no todavía disposición a pagar ni pull de mercado comprobado. La construcción se detiene si los datos no acompañan.
- **Captura de gobernanza.** Clanes de invitación, colusión supervisor–ejecutor, guardianes capturados o gerontocracia de voto son riesgos reales. Se mitigan con mezcla de equipos, revisión cruzada, mandatos a término, topes de invitación, decaimiento de voto y multisig + timelock — pero ninguna mitigación es perfecta.
- **Dependencia del founder en Stage 0.** El poder está concentrado por diseño en las primeras etapas. El decision log da legitimidad, pero la transición ordenada hacia Stage 2+ es un riesgo de ejecución que solo el tiempo y la participación real resuelven.
- **Sobre-ingeniería.** El riesgo permanente de construir infraestructura compleja antes de validar la demanda base. La disciplina de "validar antes de escalar" es la defensa principal.

---

## 13. Disclaimer

Este whitepaper es un documento estratégico y descriptivo. **No es asesoría legal, financiera, tributaria ni de inversión, ni constituye una oferta o solicitud de valores.** ZWORK es, en la fase actual, un conjunto de puntos no transferibles sin valor de mercado ni derecho de flujo garantizado; cualquier transferibilidad futura requiere aprobación de gobernanza y revisión legal y tributaria previa. La reputación y el token que se reciban no constituyen salario ni crean relación laboral o societaria. Todas las mecánicas descritas corren en testnet y varias están en fase de validación; podrán cambiar. El paso a mainnet está condicionado a auditoría independiente, acuerdo de anchor y clasificación legal de los pagos. Consulte a un profesional antes de tomar cualquier decisión basada en este documento.
