# Ficha: Sitio público y formularios

Dueño: QA (por asignar) · Revisor: John · Fecha: 2026-10-21 · Commit de referencia: 0e07d8f

## 1. Resumen

Es la cara pública de Zelena: lo que ve quien llega sin cuenta. Lo usan tres tipos de persona:

- **Visitante** (sin sesión): lee la landing `/`, el `/manifiesto`, el `/metodo`, `/encuentros`, `/privacidad` y `/acuerdo`, y navega con el menú y el pie.
- **Prospecto** (una empresa): lee `/empresas` y `/empresas/servicios` y pide una demostración en `/empresas/contacto`.
- **Founder**: lee en `/admin` lo que dejaron los formularios.

Casos de uso que cubre:

| Caso | Dónde | Qué escribe |
| --- | --- | --- |
| CU1. Un prospecto pide una demostración o una propuesta | `/empresas/contacto` → `POST /api/empresas/contacto` | una fila en `leads` |
| CU2. Alguien deja su correo para enterarse del próximo encuentro | `/encuentros` → `POST /api/encuentros/aviso` | una fila en `leads` con `interes = 'encuentros'` |
| CU3. Un visitante entiende qué es Zelena (landing, manifiesto, método, empresas, servicios) | páginas de servidor | nada (solo lectura) |
| CU4. Un visitante comprueba que hay actividad real (cifras en vivo y transacción en la red de pruebas) | landing, `PruebaEnVivo` y `PruebaTestnet` | nada (lee la base y un JSON versionado) |
| CU5. Un visitante lee el aviso de privacidad y el acuerdo que se firma al entrar | `/privacidad`, `/acuerdo` | nada |
| CU6. Un enlace viejo sigue funcionando | redirecciones 308 de `next.config.mjs` | nada |
| CU7. El founder revisa prospectos y avisos | `/admin` (secciones "Solicitudes de empresas" y "Avisos de encuentros") | nada (lee `leads`) |

**Whitepaper retirado.** Por decisión del founder, el sitio deja solo el manifiesto: esta ficha documenta `/whitepaper` como una redirección permanente a `/manifiesto`. Ese cambio se hace en otra rama; en el commit de referencia todavía existen `app/whitepaper/page.tsx`, el enlace "Whitepaper" del pie (`src/lib/menu.ts:119`) y el enlace "Leer el whitepaper" de `/metodo` (`app/metodo/page.tsx:98`). La sección 6 lista todo lo que esa rama tiene que tocar.

Fuera de esta ficha (tienen la suya): `/comunidad` y ritos, `/agora`, `/gobernanza`, `/academia`, `/entrar` (login) y el resto de `/admin`.

## 2. Diagrama (DFD)

Archivo: [`docs/dfd/sitio-publico-y-formularios.tm7`](../dfd/sitio-publico-y-formularios.tm7), más la imagen exportada [`docs/dfd/sitio-publico-y-formularios.svg`](../dfd/sitio-publico-y-formularios.svg). Los dos se generan desde la fuente [`docs/dfd/sitio-publico-y-formularios.json`](../dfd/sitio-publico-y-formularios.json) con `python docs/dfd/generar_tm7.py docs/dfd/sitio-publico-y-formularios.json --estricto`, que pasa: cada `codigo` existe en el repo. La fuente tiene 29 elementos (3 actores, 18 procesos, 8 almacenes), 47 flujos (12 sensibles) y 5 fronteras de confianza.

Se lee de izquierda a derecha. El visitante pide páginas al servidor Next.js; casi todas son texto fijo. Solo tres cosas tocan datos: el layout y la landing **leen** la base (sesión, menú, cifras), los dos formularios **escriben** en `leads` a través de su ruta de API, y `/admin` **lee** `leads`. Los formularios y el menú corren en el navegador (frontera "Internet"). Los flujos con `*` y en rojo llevan datos personales o la cookie de sesión.

```mermaid
flowchart LR
  subgraph F1["Internet: navegadores del visitante y del founder"]
    u[/"Visitante o prospecto (navegador)"/]
    founder[/"Founder en /admin (navegador)"/]
    p_menu(("Menú contextual (navegador)"))
    p_form_contacto(("Formulario de contacto (navegador)"))
    p_form_aviso(("Formulario de aviso de encuentros (navegador)"))
  end
  subgraph F2["Servicio externo: explorador de la red de pruebas de Stellar"]
    explorador[/"Explorador público de la red de pruebas (stellar.expert)"/]
  end
  subgraph F3["Servidor Next.js (Azure App Service)"]
    p_redir(("Redirecciones 308"))
    p_layout(("Layout raíz (sesión, Nav, banner, pie)"))
    p_pie(("Pie de página"))
    p_landing(("Landing /"))
    p_manifiesto(("Página /manifiesto"))
    p_metodo(("Página /metodo"))
    p_empresas(("Página /empresas"))
    p_servicios(("Página /empresas/servicios"))
    p_contacto(("Página /empresas/contacto"))
    p_encuentros(("Página /encuentros"))
    p_privacidad(("Página /privacidad"))
    p_acuerdo(("Página /acuerdo"))
    p_api_contacto(("POST /api/empresas/contacto"))
    p_api_aviso(("POST /api/encuentros/aviso"))
    p_admin(("Página /admin (Solicitudes de empresas y Avisos de encuentros)"))
    s_rl[("Contadores de límite de tasa en memoria")]
    s_catalogo[("Catálogo de servicios e intereses (constante)")]
    s_encuentros[("Lista de encuentros publicados (constante)")]
    s_pruebas[("Pruebas de testnet versionadas (src/data/pruebas-testnet.json)")]
  end
  subgraph F4["Almacenamiento persistente (SQLite y archivos del paquete)"]
    s_leads[("Tabla leads (SQLite)")]
    s_db[("Base SQLite: proyectos, entregas, firmas, usuarios, ritos y genoma (solo lectura aquí)")]
    s_cla[("Texto del acuerdo (CLA.md)")]
  end
  subgraph F5["Configuración del despliegue (App Settings)"]
    s_env[("Configuración del despliegue (ZELENA_LEGAL_NAME, ZELENA_PRIVACY_EMAIL)")]
  end
  u -->|"f1 Pide una ruta vieja"| p_redir
  p_redir -->|"f2 Redirección permanente"| u
  u -->|"f3 Pide cualquier página pública *"| p_layout
  s_db -->|"f4 Acceso al trabajo y mutación anunciada"| p_layout
  p_layout -->|"f5 Banderas del menú"| p_menu
  p_layout -->|"f6 Pinta el pie"| p_pie
  u -->|"f7 Abre la landing"| p_landing
  s_db -->|"f8 Cifras en vivo y próximo rito"| p_landing
  s_pruebas -->|"f9 Pruebas verificables"| p_landing
  s_encuentros -->|"f10 Encuentros próximos"| p_landing
  p_landing -->|"f11 HTML de la landing"| u
  u -->|"f12 Abre la transacción en el explorador"| explorador
  u -->|"f13 Abre el manifiesto"| p_manifiesto
  p_manifiesto -->|"f14 HTML del manifiesto"| u
  u -->|"f15 Abre el método"| p_metodo
  p_metodo -->|"f16 HTML del método"| u
  u -->|"f17 Abre /empresas"| p_empresas
  p_empresas -->|"f18 HTML comercial"| u
  u -->|"f19 Abre /empresas/servicios"| p_servicios
  s_catalogo -->|"f20 Seis líneas de servicio"| p_servicios
  p_servicios -->|"f21 HTML del catálogo"| u
  u -->|"f22 Abre el contacto"| p_contacto
  p_contacto -->|"f23 Monta el formulario"| p_form_contacto
  s_catalogo -->|"f24 Opciones del selector"| p_form_contacto
  u -->|"f25 Llena el formulario *"| p_form_contacto
  p_form_contacto -->|"f26 Envía la solicitud *"| p_api_contacto
  p_api_contacto -->|"f27 Cuenta el envío *"| s_rl
  s_catalogo -->|"f28 Valida el interés"| p_api_contacto
  p_api_contacto -->|"f29 Guarda la solicitud *"| s_leads
  p_api_contacto -->|"f30 Respuesta"| p_form_contacto
  u -->|"f31 Abre /encuentros"| p_encuentros
  s_encuentros -->|"f32 Fechas publicadas y formatos"| p_encuentros
  p_encuentros -->|"f33 Monta el formulario de aviso"| p_form_aviso
  u -->|"f34 Deja su correo *"| p_form_aviso
  p_form_aviso -->|"f35 Envía el aviso *"| p_api_aviso
  p_api_aviso -->|"f36 Cuenta el envío *"| s_rl
  p_api_aviso -->|"f37 Guarda el aviso *"| s_leads
  p_api_aviso -->|"f38 Respuesta"| p_form_aviso
  u -->|"f39 Abre /privacidad"| p_privacidad
  s_env -->|"f40 Responsable del tratamiento"| p_privacidad
  p_privacidad -->|"f41 HTML del aviso"| u
  u -->|"f42 Abre /acuerdo"| p_acuerdo
  s_cla -->|"f43 Texto y huella del acuerdo"| p_acuerdo
  p_acuerdo -->|"f44 HTML del acuerdo"| u
  founder -->|"f45 Abre /admin *"| p_admin
  s_leads -->|"f46 Lee solicitudes y avisos *"| p_admin
  p_admin -->|"f47 Listas de prospectos *"| founder
  linkStyle 2,24,25,26,28,33,34,35,36,44,45,46 stroke:#b03a2e,color:#b03a2e
  style F1 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F2 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F3 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F4 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F5 fill:none,stroke:#c0392b,stroke-dasharray:6 4
```

Notas de lectura:

- Las rutas públicas **no pasan por el middleware**: su `matcher` solo cubre `/perfil`, `/admin`, `/equipo` y `/clientes` (`apps/web/middleware.ts:51`). Por eso no hay un proceso "middleware" en el diagrama, salvo como puerta de `/admin` (flujo f45).
- `f3` se repite en todas las páginas: el layout raíz lee la cookie (`getSession`) en cada petición, así que todo el sitio se pinta por petición.
- `f12` no pasa por nuestro servidor: es un enlace que abre el navegador del visitante.

## 3. Recorrido de una acción

Acción elegida: **un prospecto pide una propuesta de WMS desde el catálogo de servicios.**

1. **Pantalla o componente.** En `/empresas/servicios` (`app/empresas/servicios/page.tsx#Servicios`) cada línea del catálogo `SERVICIOS` tiene "Solicitar propuesta", que enlaza a `/empresas/contacto?interes=wms` (línea 52). La página `app/empresas/contacto/page.tsx#Contacto` pasa `searchParams.interes` al formulario de cliente `src/components/ContactoForm.tsx#ContactoForm`, que lo usa solo si es un slug de `INTERESES` (`ContactoForm.tsx:9`); si no, preselecciona "harmony". El formulario pide nombre, correo, empresa (opcional), interés, mensaje (opcional), un campo trampa oculto `sitio` (líneas 133-142) y la casilla de autorización de datos, obligatoria y sin marcar (líneas 145-160).
2. **Llamada al backend.** `fetch("/api/empresas/contacto", { method: "POST" })` con JSON `{ nombre, email, empresa, interes, mensaje, sitio }` (`ContactoForm.tsx:24-28`). **La casilla no viaja**: solo la exige el navegador con `required`.
3. **Ruta y controlador.** `apps/web/app/api/empresas/contacto/route.ts#POST`. Es pública: no hay sesión ni middleware.
4. **Lógica de negocio.**
   - Límite de tasa: `rateLimit("lead:" + clientIp(req.headers), 5, 10 min)` (`route.ts:12`). La IP es el **primer** valor de `X-Forwarded-For` (`src/lib/rate-limit.ts:22-24`). Si se pasa, 429.
   - Cuerpo: `req.json()`; si no es un objeto, 400 "Revisa los datos del formulario." (`route.ts:19-22`).
   - Validación: `leadSchema.safeParse` (`src/lib/validation.ts:122-129`): nombre de 2 a 80 caracteres con `trim`, correo válido de hasta 120, empresa hasta 120, `interes` dentro de `SLUGS_INTERES` (`src/lib/servicios.ts:93`: harmony, las seis líneas del catálogo y "otro"), mensaje hasta 2000, `sitio` hasta 500. Si falla, 400 con el primer mensaje de zod en español ("Escribe tu nombre.", "Revisa el correo.", "Elige qué te interesa.").
   - Campo trampa: si `sitio` trae algo, responde 200 `{ ok: true }` **sin guardar** (`route.ts:36`), para no avisarle al bot.
5. **Base de datos.** `INSERT INTO leads (nombre, email, empresa, interes, mensaje)` con parámetros; empresa y mensaje vacíos se guardan como `NULL` (`route.ts:38-40`). La tabla (`src/lib/schema.sql:721-730`) pone `estado = 'nuevo'` y `created_at = datetime('now')` (UTC). No hay relación con `users`: el prospecto no tiene cuenta.
6. **Respuesta y qué hace la pantalla.** 200 `{ ok: true }`. El formulario se reemplaza por `"Gracias, <primer nombre>. Te escribimos a <correo> para coordinar la conversación."` (`ContactoForm.tsx:42-54`). Nadie recibe un aviso: la solicitud aparece cuando el founder abre `/admin`, sección "Solicitudes de empresas" (`app/admin/page.tsx:63-76` y `294-322`), que lee las 100 filas más recientes de `leads` y separa las de `interes = 'encuentros'`.
7. **Casos de falla.**
   - 400 con el mensaje de zod: la pantalla lo muestra tal cual (`ContactoForm.tsx:30-33`).
   - 429 tras 5 envíos en 10 minutos desde la misma "IP"; el contador vive en la memoria del proceso y se pierde al reiniciar.
   - Sin red: "Sin conexión. Revisa tu red e intenta de nuevo." (línea 38).
   - Si la base falla, la ruta lanza y Next responde 500 sin JSON; la pantalla cae al mensaje genérico "No pudimos enviar tu mensaje. Intenta de nuevo."
   - Un bot que llena `sitio` recibe 200 y no deja nada.

Las otras acciones del feature, en corto:

- **Aviso de encuentros** (`/encuentros` → `AvisoEncuentrosForm` → `app/api/encuentros/aviso/route.ts#POST`): mismo patrón y mismos errores, con `avisoEncuentrosSchema` (`validation.ts:136-141`), contador propio `aviso:<IP>` (`route.ts:12`) y la fila `interes = 'encuentros'`, `empresa = NULL`, `mensaje = 'Ciudad: …'` (`route.ts:34-36`).
- **Landing** (`app/page.tsx#Landing`): `cifrasEnVivo(getDb())` (`src/lib/prueba-en-vivo.ts:23`) cuenta proyectos abiertos, entregas aprobadas de cuentas no demo y firmas con un hash de Stellar real; `PruebaTestnet` muestra la última transacción de `src/data/pruebas-testnet.json` (o, si no hay, la última firma anclada); `ProximoEncuentro` anuncia el próximo encuentro de `ENCUENTROS` (hoy vacío) o el próximo rito de comunidad. El cierre ofrece "Entrar" y, como no hay encuentros publicados, "Ven a la próxima demo" (`app/page.tsx:82-90`).
- **Menú** (`src/components/Nav.tsx#Nav` en el servidor, `NavContextual` en el navegador): `menuPara` (`src/lib/menu.ts:84`) da las cuatro puertas sin sesión, el menú de empresas en `/empresas*` y, con sesión, el trabajo según el acceso que Nav resuelve **contra la base** (`Nav.tsx:20-28`). "Admin" sale solo con el rol de founder en los claims; la puerta real está en el servidor.
- **Pie** (`src/components/Footer.tsx#Footer`): grupos de `FOOTER_GRUPOS` (`menu.ts:112`) y el aviso de red de pruebas `AVISO_LEGAL` (`menu.ts:140`).
- **Redirecciones** (`next.config.mjs#redirects`, líneas 80-85): `/ecosistema` → `/metodo` y `/academia/por-que-sas-dao` → `/academia/construir-sin-riesgo`, ambas 308. La rama del retiro del whitepaper añade `/whitepaper` → `/manifiesto`.

## 4. Elementos del DFD en el código

| Elemento | Tipo | Archivo y función | Notas |
| --- | --- | --- | --- |
| Visitante o prospecto (`u`) | Actor | `apps/web/app/layout.tsx#RootLayout` | Entra por el layout raíz en cada página; puede traer la cookie `zelena_session`. |
| Founder en /admin (`founder`) | Actor | `apps/web/app/admin/page.tsx#AdminPage` | Rol leído de la base con `adminActor` (`admin/page.tsx:33`). |
| Explorador de la red de pruebas (`explorador`) | Actor | `apps/web/src/lib/pruebas-testnet.ts#EXPLORADOR_TX` | stellar.expert, testnet. Solo recibe clics del navegador. |
| Redirecciones 308 (`p_redir`) | Proceso | `apps/web/next.config.mjs#redirects` | Líneas 80-85. `/whitepaper` → `/manifiesto` llega en la rama paralela. |
| Layout raíz (`p_layout`) | Proceso | `apps/web/app/layout.tsx#RootLayout` | `getSession()` (línea 51), `Nav` (61), `MutationBanner` (62), `Footer` (64). `Nav.tsx#Nav` resuelve el acceso con `authz.accesoEquipo`. |
| Menú contextual (`p_menu`) | Proceso | `apps/web/src/components/NavContextual.tsx#NavContextual` | Componente de cliente; arma enlaces con `src/lib/menu.ts#menuPara`. Solo dibuja. |
| Pie (`p_pie`) | Proceso | `apps/web/src/components/Footer.tsx#Footer` | `FOOTER_GRUPOS`, `AVISO_LEGAL`, `esEnlaceExterno`. |
| Landing (`p_landing`) | Proceso | `apps/web/app/page.tsx#Landing` | `force-dynamic`. Usa `PruebaEnVivo`, `PruebaTestnet`, `ProximoEncuentro`. |
| Manifiesto (`p_manifiesto`) | Proceso | `apps/web/app/manifiesto/page.tsx#Manifiesto` | Texto en constantes `ORIGEN` y `GRUPOS` (nueve principios). Reemplaza al whitepaper. |
| Método (`p_metodo`) | Proceso | `apps/web/app/metodo/page.tsx#Metodo` | `PASOS_METODO` de `src/lib/metodo.ts`; también los usa `IntroEcosistema` en `/entrar`. |
| Empresas (`p_empresas`) | Proceso | `apps/web/app/empresas/page.tsx#Empresas` | Constantes `ESTADO`, `FASES`, `PASOS`, `STELLAR`; anclas `#productos` y `#como-funciona`. |
| Servicios (`p_servicios`) | Proceso | `apps/web/app/empresas/servicios/page.tsx#Servicios` | Lee `SERVICIOS`; cada línea enlaza a contacto con `?interes=<slug>`. |
| Contacto (`p_contacto`) | Proceso | `apps/web/app/empresas/contacto/page.tsx#Contacto` | Pasa `searchParams.interes` al formulario. |
| Encuentros (`p_encuentros`) | Proceso | `apps/web/app/encuentros/page.tsx#Encuentros` | `proximosEncuentros()`, `FORMATOS`; `revalidate = 3600` (sin efecto, ver sección 9). |
| Privacidad (`p_privacidad`) | Proceso | `apps/web/app/privacidad/page.tsx#Privacidad` | `force-dynamic`; responsable con `src/lib/legal.ts#responsableTratamiento`. |
| Acuerdo (`p_acuerdo`) | Proceso | `apps/web/app/acuerdo/page.tsx#Acuerdo` | `readClaText()` y `claCanonicalHash()` (líneas 29-30): el mismo texto que firma `/entrar`. |
| Formulario de contacto (`p_form_contacto`) | Proceso | `apps/web/src/components/ContactoForm.tsx#ContactoForm` | Cliente. Campo trampa y casilla de autorización solo en el navegador. |
| Formulario de aviso (`p_form_aviso`) | Proceso | `apps/web/src/components/AvisoEncuentrosForm.tsx#AvisoEncuentrosForm` | Cliente. Mismo patrón. |
| API de contacto (`p_api_contacto`) | Proceso | `apps/web/app/api/empresas/contacto/route.ts#POST` | Límite, zod (`leadSchema`), trampa, `INSERT`. |
| API de aviso (`p_api_aviso`) | Proceso | `apps/web/app/api/encuentros/aviso/route.ts#POST` | Límite, zod (`avisoEncuentrosSchema`), trampa, `INSERT`. |
| /admin (`p_admin`) | Proceso | `apps/web/app/admin/page.tsx#AdminPage` | `SELECT * FROM leads ORDER BY id DESC LIMIT 100` (línea 64); separa por `INTERES_ENCUENTROS` (75-76). |
| Tabla leads (`s_leads`) | Almacén | `apps/web/src/lib/schema.sql#leads` | Líneas 721-732. Columnas: nombre, email, empresa, interes, mensaje, estado, created_at. |
| Base SQLite de lectura (`s_db`) | Almacén | `apps/web/src/lib/db.ts#getDb` | Tablas `projects`, `milestones`, `assignments`, `assignment_events`, `users`, `cla_signatures`, `rite_sessions`, `genome_versions`. |
| Contadores de límite (`s_rl`) | Almacén | `apps/web/src/lib/rate-limit.ts#rateLimit` | `Map` en `globalThis.__zelenaRL` (líneas 7-8): por proceso, sin purga. |
| Catálogo (`s_catalogo`) | Almacén | `apps/web/src/lib/servicios.ts#INTERESES` | `SERVICIOS` (línea 15), `INTERESES` (87), `SLUGS_INTERES` (93), `INTERES_ENCUENTROS` (97). Una fuente para página, formulario y validación. |
| Encuentros publicados (`s_encuentros`) | Almacén | `apps/web/src/lib/encuentros.ts#ENCUENTROS` | Arreglo en el código (línea 20), hoy vacío. Publicar una fecha es editar el código. |
| Pruebas de testnet (`s_pruebas`) | Almacén | `apps/web/src/lib/pruebas-testnet.ts#PRUEBAS_TESTNET` | Importa `src/data/pruebas-testnet.json`; `contenidoTarjeta` filtra lo que no es verificable. |
| Texto del acuerdo (`s_cla`) | Almacén | `apps/web/src/lib/cla.ts#readClaText` | Lee `CLA.md` del disco; si no lo encuentra, usa un texto de reserva (línea 18). |
| Configuración del despliegue (`s_env`) | Almacén | `apps/web/src/lib/legal.ts#responsableTratamiento` | `ZELENA_LEGAL_NAME`, `ZELENA_PRIVACY_EMAIL`; sin ellas, "Zelena" y el formulario de contacto. |

## 5. Flujos de datos

Los marcados **[sensible]** llevan datos personales, la cookie de sesión o la IP del visitante.

| Flujo | De → a | Protocolo | Datos que viajan |
| --- | --- | --- | --- |
| f1 | Visitante → Redirecciones | HTTPS | GET `/ecosistema`, `/academia/por-que-sas-dao` o `/whitepaper` |
| f2 | Redirecciones → Visitante | HTTPS | 308 con `Location` `/metodo`, `/academia/construir-sin-riesgo` o `/manifiesto` |
| f3 | Visitante → Layout | HTTPS | **[sensible: sesión]** GET de la página y cookie `zelena_session` (JWT) si hay sesión |
| f4 | Base SQLite → Layout | SQL | `users` y membresías de la wallet de la sesión (`accesoEquipo`); `genome_versions` (`pendingMutation`) |
| f5 | Layout → Menú | HTTPS | banderas `conSesion`, `accesoEquipo`, `esInterno`, `puedeVerTodo`, `isFounder`; botón de perfil con nombre visible |
| f6 | Layout → Pie | Llamada en proceso | `FOOTER_GRUPOS`, `AVISO_LEGAL` |
| f7 | Visitante → Landing | HTTPS | GET `/` |
| f8 | Base SQLite → Landing | SQL | conteos de `projects` abiertos, `milestones` aprobados y `assignment_events` 'aprobar' de cuentas no demo; `tx_id` de `cla_signatures`; próximo rito de comunidad |
| f9 | Pruebas de testnet → Landing | Import de módulo | hashes de transacción e ids de contrato públicos |
| f10 | Encuentros → Landing | Import de módulo | `ENCUENTROS` (vacía) |
| f11 | Landing → Visitante | HTTPS | HTML: frase, puertas, cifras, tarjeta de pruebas, lo próximo, CTA |
| f12 | Visitante → Explorador | HTTPS | hash de transacción o id de contrato (públicos) |
| f13 | Visitante → Manifiesto | HTTPS | GET `/manifiesto` |
| f14 | Manifiesto → Visitante | HTTPS | HTML con el origen y los nueve principios |
| f15 | Visitante → Método | HTTPS | GET `/metodo` |
| f16 | Método → Visitante | HTTPS | HTML con `PASOS_METODO` y el reparto 20/70/10 |
| f17 | Visitante → Empresas | HTTPS | GET `/empresas` |
| f18 | Empresas → Visitante | HTTPS | HTML comercial |
| f19 | Visitante → Servicios | HTTPS | GET `/empresas/servicios` |
| f20 | Catálogo → Servicios | Import de módulo | `SERVICIOS` |
| f21 | Servicios → Visitante | HTTPS | HTML con enlaces `/empresas/contacto?interes=<slug>` |
| f22 | Visitante → Contacto | HTTPS | GET `/empresas/contacto?interes=<slug>` |
| f23 | Contacto → Formulario de contacto | HTTPS | `interesInicial` |
| f24 | Catálogo → Formulario de contacto | Import de módulo | `INTERESES` (opciones del selector) |
| f25 | Visitante → Formulario de contacto | Interacción de usuario | **[sensible: datos personales]** nombre, correo, empresa, interés, mensaje y casilla de autorización |
| f26 | Formulario de contacto → API de contacto | HTTPS | **[sensible: datos personales]** POST JSON `{nombre, email, empresa, interes, mensaje, sitio}`; la casilla no viaja |
| f27 | API de contacto → Contadores | Memoria del proceso | **[sensible: IP]** clave `lead:<IP>` |
| f28 | Catálogo → API de contacto | Import de módulo | `SLUGS_INTERES` para el enum de `leadSchema` |
| f29 | API de contacto → leads | SQL | **[sensible: datos personales]** `INSERT` nombre, email, empresa, interes, mensaje |
| f30 | API de contacto → Formulario de contacto | HTTPS | 200 `{ok:true}`, 400 o 429 `{error}` |
| f31 | Visitante → Encuentros | HTTPS | GET `/encuentros` |
| f32 | Encuentros publicados → Encuentros | Import de módulo | `ENCUENTROS`, `FORMATOS` |
| f33 | Encuentros → Formulario de aviso | HTTPS | HTML con `AvisoEncuentrosForm` |
| f34 | Visitante → Formulario de aviso | Interacción de usuario | **[sensible: datos personales]** nombre, correo, ciudad, casilla |
| f35 | Formulario de aviso → API de aviso | HTTPS | **[sensible: datos personales]** POST JSON `{nombre, email, ciudad, sitio}`; la casilla no viaja |
| f36 | API de aviso → Contadores | Memoria del proceso | **[sensible: IP]** clave `aviso:<IP>` |
| f37 | API de aviso → leads | SQL | **[sensible: datos personales]** `INSERT` con `interes = 'encuentros'`, `mensaje = 'Ciudad: …'` |
| f38 | API de aviso → Formulario de aviso | HTTPS | 200 `{ok:true}`, 400 o 429 `{error}` |
| f39 | Visitante → Privacidad | HTTPS | GET `/privacidad` |
| f40 | Configuración → Privacidad | Variables de entorno | `ZELENA_LEGAL_NAME`, `ZELENA_PRIVACY_EMAIL` |
| f41 | Privacidad → Visitante | HTTPS | HTML del aviso (Ley 1581) |
| f42 | Visitante → Acuerdo | HTTPS | GET `/acuerdo` |
| f43 | CLA.md → Acuerdo | Archivo (fs) | texto del acuerdo y su SHA-256 |
| f44 | Acuerdo → Visitante | HTTPS | resumen, texto completo y huella |
| f45 | Founder → /admin | HTTPS | **[sensible: sesión]** GET `/admin` con la cookie de sesión |
| f46 | leads → /admin | SQL | **[sensible: datos personales]** `SELECT * FROM leads ORDER BY id DESC LIMIT 100` |
| f47 | /admin → Founder | HTTPS | **[sensible: datos personales]** nombre, correo (`mailto:`), empresa, interés, mensaje o ciudad, fecha |

## 6. Dependencias con otras features

- **Login y sesión**: el layout lee la cookie con `getSession` (`src/lib/session.ts:11`) y `verifySession` (`src/lib/jwt.ts:48`); el menú cambia con sesión y el botón "Entrar" lleva a `/entrar`. `/acuerdo` comparte `src/lib/cla.ts` con `/api/cla` y el alta.
- **Admin**: `/admin` es el único lector de `leads`; su puerta es `adminActor` (`src/lib/authz.ts:80`).
- **Talento, proyectos y membresías**: `Nav` decide "Mi día" y "Proyectos" con `authz.accesoEquipo` y `roles.ts` (`esEquipoInterno`, `puedeVerTodoElEquipo`).
- **Comunidad y ritos**: `ProximoEncuentro` usa `proximoRitoDeComunidad` y `zonaRitos` (`src/lib/ritos.ts`) y `RUTA_COMUNIDAD`; la puerta "Comunidad" de la landing y del menú apunta a `/comunidad`.
- **Ágora e hitos, Actividades**: las cifras en vivo cuentan `projects`, `milestones` y `assignment_events` (`prueba-en-vivo.ts:23-59`).
- **Anclaje en Stellar**: la tarjeta de pruebas usa `cla_signatures.tx_id` como respaldo y el JSON versionado de la corrida de testnet.
- **Gamificación, épocas y genoma**: `MutationBanner` (en el layout) lee `pendingMutation`.
- **Academia**: enlaces del menú y del pie; redirección del slug viejo `/academia/por-que-sas-dao`.
- **Retiro del whitepaper (rama paralela)**: además de borrar `app/whitepaper/page.tsx` y añadir la redirección, toca `src/lib/menu.ts:119` (pie), `app/metodo/page.tsx:98-101` (enlace), `next.config.mjs:39,47` (`docs/whitepaper.md` en `ARCHIVOS_DE_RUNTIME`), `apps/web/scripts/verificar-paquete.mjs:204-214` (hoy **falla** el paquete si falta `docs/whitepaper.md`), `apps/web/start-azure.sh:10`, `packages/scripts/smoke-wp31.sh:33,37` (pide `/whitepaper` en 200), `src/lib/menu.test.ts:172-173`, `src/lib/contenido-publico.test.ts:58,82-96,608,622,757` y `src/lib/verificar-paquete.test.ts`. También hay comentarios que citan el whitepaper como fuente: `app/manifiesto/page.tsx:10`, `src/lib/encuentros.ts:22` y `middleware.ts:6`.

Dependencias inversas anotadas al integrar (la otra ficha ya las tenía; la guía pide anotarlas en las dos):

- **Clientes y grafo** ([clientes-y-grafo.md](clientes-y-grafo.md)): el enlace «Clientes» del menú solo aparece para el equipo interno (`src/lib/menu.ts:60` y `:99`).
- **Dashboard** ([dashboard.md](dashboard.md)): `menuPara` (`src/lib/menu.ts:84-102`) no tiene entrada para `/equipo/dashboard`; hoy solo se llega escribiendo la URL.
- **SLA, recordatorios y avisos** ([sla-recordatorios-y-avisos.md](sla-recordatorios-y-avisos.md)): el enlace «Avisos» del menú (`AVISOS_EN_MENU`, `src/lib/menu.ts:45` y `:97`).
- **Telegram** ([telegram.md](telegram.md)): `/privacidad` declara que se guarda el id de chat de Telegram; la ficha de Telegram pide nombrar además a Telegram y Anthropic como destinos de datos.

## 7. Amenazas relevantes

| Amenaza | Categoría | Elemento | Estado | Justificación |
| --- | --- | --- | --- | --- |
| Evadir el límite por IP mandando un `X-Forwarded-For` inventado | Suplantación (S) | Contadores, API de contacto, API de aviso | Pendiente | `src/lib/rate-limit.ts:22-24` usa el primer valor de la cabecera, que en Azure App Service pone el cliente (el proxy añade la IP real al final). Ya está en `docs/security-review.md` (H7 y la nota sobre `x-forwarded-for`). La prueba de caracterización lo fija. |
| Llenar `leads` con envíos automáticos desde una misma IP | Denegación de servicio (D) | API de contacto, API de aviso, leads | Mitigada | 5 envíos por 10 min por IP (`app/api/empresas/contacto/route.ts:12`, `app/api/encuentros/aviso/route.ts:12`), campo trampa que descarta sin avisar (`contacto/route.ts:36`, `aviso/route.ts:32`) y longitudes máximas (`validation.ts:122-129`, `136-141`). Queda abierta la evasión de la fila anterior. |
| Agotar memoria con claves nuevas del límite (una por "IP" inventada) | Denegación de servicio (D) | Contadores | Pendiente | `rate-limit.ts:10-19` solo reemplaza el contador vencido de la misma clave; el `Map` de las líneas 7-8 nunca se purga. |
| Inyección SQL con los campos del formulario | Manipulación (T) | leads | Mitigada | `INSERT` con parámetros (`contacto/route.ts:38-40`, `aviso/route.ts:34-36`) y tipos de zod antes. |
| Guardar HTML o JS en nombre o mensaje para que se ejecute al abrir `/admin` | Elevación de privilegios (E) | /admin | Mitigada | React escapa el texto (`app/admin/page.tsx:308,316,337-339`); el `mailto:` solo recibe correos que pasaron `z.string().email()` (`validation.ts:124`), así que no entra un `javascript:`. |
| Leer los prospectos sin ser founder | Divulgación de información (I) | leads, /admin | Mitigada | `middleware.ts:24,51` exige sesión con acuerdo firmado y la página exige el rol de la base (`app/admin/page.tsx:28,33`; `src/lib/authz.ts:80-84`). |
| No poder probar que la persona autorizó el tratamiento de sus datos | Repudio (R) | Formularios, APIs, leads | Pendiente | La casilla solo existe en el navegador (`ContactoForm.tsx:145-160`, `AvisoEncuentrosForm.tsx:111-126`); `leadSchema` no la recibe y `leads` no tiene columna para ella (`schema.sql:721-730`). Una llamada directa guarda sin casilla. `/privacidad` (línea 118) promete "pedir prueba de esa autorización". |
| Conservar datos personales sin plazo y sin forma de suprimirlos | Divulgación de información (I) | leads | Pendiente | No hay `DELETE` ni `UPDATE` sobre `leads` en todo el repo; `estado` nunca sale de 'nuevo'. `/privacidad` ofrece suprimir los datos. |
| Falsificar la cookie para ver el menú del equipo o "Admin" | Suplantación (S) | Layout, Menú | Mitigada | JWT HS256 verificado (`jwt.ts:48-55`) con `SESSION_SECRET` de al menos 32 caracteres obligatorio en producción (`jwt.ts:8-15`). Además el menú solo dibuja: las puertas reales están en `middleware.ts:51` y en cada página. |
| Ver herramientas internas desde el menú sin tener acceso | Elevación de privilegios (E) | Menú | Mitigada | `menuPara` sin sesión devuelve `MENU_PUBLICO` (`menu.ts:84-102`); el acceso al trabajo se calcula contra la base (`Nav.tsx:20-28`). Lo cubren `menu.test.ts` y esta prueba. |
| Mostrar en `/acuerdo` un texto distinto del que se firma | Manipulación (T) | CLA.md, /acuerdo | Mitigada | Mismo lector que `/api/cla` (`cla.ts:6-24`); `CLA.md` va en `outputFileTracingIncludes` (`next.config.mjs:41-48,60-62`) y `scripts/verificar-paquete.mjs` lo exige antes de desplegar. El texto de reserva de `cla.ts:18` sigue como último recurso. |
| Meter el sitio en un iframe ajeno para engañar al que llena el formulario | Manipulación (T) | Formularios | Mitigada | `X-Frame-Options: DENY` y `frame-ancestors 'none'` (`next.config.mjs:17,70`); `form-action 'self'` (línea 16). |
| Inyectar algo por `?interes=` en el formulario | Manipulación (T) | Contacto | Mitigada | `ContactoForm.tsx:9` solo acepta un slug de `INTERESES`; cualquier otro valor cae a "harmony". |
| Tumbar la landing si la base no responde | Denegación de servicio (D) | Landing | Pendiente | `app/page.tsx:28` llama `cifrasEnVivo(getDb())` sin `try/catch`; `ProximoEncuentro.tsx:20-27` y `MutationBanner.tsx:25-29` sí se protegen. |

## 8. Prueba de caracterización

Archivo: `apps/web/src/lib/caracterizacion/sitio-publico-y-formularios.test.ts` (26 casos, pasan).

Cómo correrla: `cd apps/web && npx vitest run src/lib/caracterizacion/sitio-publico-y-formularios.test.ts`.

Qué cubre:

- **Flujo principal**: llama al `POST` real de `app/api/empresas/contacto/route.ts` con un `NextRequest` contra una base SQLite en memoria con `schema.sql` (inyectada en `globalThis.__zelenaDb`, que es lo primero que mira `getDb`). Comprueba la fila en `leads` (trim, `NULL` en opcionales, `estado = 'nuevo'`), los 400 con sus mensajes en español, el campo trampa, el 429 al sexto envío y el catálogo de intereses.
- **Aviso de encuentros**: la fila con `interes = 'encuentros'` y `mensaje = 'Ciudad: …'`, el campo trampa, el correo inválido y que su límite es aparte del de contacto.
- **Menú, pie y redirecciones**: `menuPara` sin sesión, en `/empresas*` y con sesión de comunidad; el grupo Legal del pie; las 308 de `next.config.mjs` (y, si ya está, que `/whitepaper` vaya a `/manifiesto`).
- **Datos de la landing y de `/privacidad`**: `cifrasEnVivo` en base vacía, con la siembra demo y con una firma real; `ENCUENTROS` vacío; `responsableTratamiento` con y sin configuración.
- **Rarezas fijadas (HALLAZGO)**: la API guarda sin la casilla de autorización; la IP del límite se puede inventar; el conteo de proyectos abiertos incluye los sembrados de demo. Si alguien las corrige, la prueba falla a propósito y se actualiza en el mismo cambio.

Para resolver el alias `@/lib/…` de las rutas (vitest no lo declara), la prueba redirige cada alias al módulo real con `vi.mock(..., () => import("../modulo"))`: no hay dobles.

Pruebas que ya existían y cubren partes del feature: `src/lib/sitio-publico.test.ts` (textos y estructura, estáticas), `src/lib/menu.test.ts`, `src/lib/legal.test.ts`, `src/lib/encuentros.test.ts`, `src/lib/contenido-publico.test.ts`. Ninguna llamaba a las rutas de los formularios ni miraba la tabla `leads`.

## 9. Preguntas abiertas

1. ¿Hay que guardar la prueba de la autorización (fecha, versión del aviso de privacidad y el valor de la casilla) junto a cada fila de `leads`? Hoy no queda nada en el servidor.
2. ¿Cuánto tiempo se conservan los `leads` y quién atiende una solicitud de supresión? No existe forma de borrarlos ni de marcarlos como atendidos (`estado` siempre es 'nuevo').
3. ¿Alguien debe enterarse cuando llega una solicitud? Hoy solo se ve si el founder abre `/admin`, y `/admin` muestra las últimas 100 filas de las dos listas juntas: 100 avisos de encuentros recientes esconderían todas las solicitudes comerciales.
4. ¿El conteo "proyectos abiertos" de la landing debe excluir los proyectos sembrados de demostración, como ya excluye entregas y firmas de cuentas demo?
5. `/empresas` promete "Autenticación con passkeys. Face ID o huella digital" (`app/empresas/page.tsx:46`), pero el código no tiene passkeys: hoy se entra con wallet (Freighter) más invitación o con el correo corporativo (Entra). ¿Se quita la frase o se marca como plan?
6. `/encuentros` declara `revalidate = 3600`, pero el layout raíz lee cookies en cada petición, así que la página ya se pinta por petición y esa línea no hace nada. ¿Se borra?
7. Publicar un encuentro exige editar `src/lib/encuentros.ts` y desplegar. ¿Basta así o debe salir de la base o de `/admin`?
8. La marca aparece como "ZELENA" en unos títulos (`/manifiesto`, `/empresas`, `/encuentros`, `/empresas/servicios`) y "Zelena" en otros (el layout y su plantilla `%s · Zelena`). ¿Cuál es la correcta?
