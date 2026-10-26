# Diagramas de flujo de datos (DFD)

Esta carpeta guarda el DFD de cada feature en el formato del ejercicio de clase (Microsoft Threat Modeling Tool 4.3). La guía del método y la plantilla de ficha están en [`docs/features/README.md`](../features/README.md).

La fuente de verdad de cada diagrama es su JSON. El `.tm7` y el `.svg` se generan con `generar_tm7.py` y no se editan a mano: si alguien mueve cajas en la herramienta y luego se regenera, esos cambios se pierden.

| Archivo | Qué es | Quién lo escribe |
| --- | --- | --- |
| `<feature>.json` | Fuente del DFD: elementos, flujos y fronteras | El documentador del feature |
| `<feature>.tm7` | Modelo para Microsoft Threat Modeling Tool 4.3 | `generar_tm7.py` |
| `<feature>.svg` | Imagen del mismo diagrama (la "imagen exportada" de la guía) | `generar_tm7.py` |
| `plantilla.tm7` | Esqueleto de un `.tm7` vacío con la base de conocimiento de la herramienta | `generar_tm7.py --limpiar-plantilla` |
| `generar_tm7.py` | Generador y validador (Python 3, solo biblioteca estándar) | |

## Esquema del JSON

```json
{
  "feature": "<slug, igual al nombre del archivo>",
  "titulo": "<texto>",
  "commit": "<hash de referencia>",
  "elementos": [
    { "id": "u", "tipo": "actor | proceso | almacen", "nombre": "<texto>", "codigo": "<archivo>#<función o componente>" }
  ],
  "flujos": [
    { "id": "f1", "de": "<id>", "a": "<id>", "nombre": "<texto>",
      "protocolo": "HTTPS | SQL | Stellar | Telegram | ...", "datos": "<qué viaja>", "sensible": true }
  ],
  "fronteras": [
    { "nombre": "<texto>", "contiene": ["<id>", "..."] }
  ]
}
```

Reglas:

- Cada elemento tiene que existir en el código. `codigo` es `ruta/del/archivo#símbolo`; la ruta puede ser desde la raíz del repo, desde `apps/web` o desde `apps/web/src`. El generador avisa si el archivo no existe o si el símbolo no aparece en él (con `--estricto`, el aviso es error). Se admiten varios símbolos separados por coma.
- `sensible: true` marca credenciales, tokens, firmas, secretos y datos personales. En la imagen y en el Mermaid esos flujos van en rojo y con `*`, y en el `.tm7` quedan listados en "Assumptions" del modelo.
- Un elemento debería estar en una sola frontera. Si está en dos, se dibuja en la primera y el generador avisa.
- Un flujo debería tocar al menos un proceso (regla de DFD). Si une dos actores o dos almacenes, el generador avisa pero no falla.
- Campo opcional `"tmt"` en un elemento o una frontera: fija el tipo de la herramienta a mano (por ejemplo `"SE.P.TMCore.BrowserClient"`). Sin él se elige solo, como dice la tabla de abajo.

## Uso

Desde la raíz del repo (en Windows, `python` o `py -3`):

```bash
python docs/dfd/generar_tm7.py docs/dfd/login-y-sesion.json   # un feature
python docs/dfd/generar_tm7.py --todos                        # todos los docs/dfd/*.json
python docs/dfd/generar_tm7.py --todos --estricto             # además exige que cada "codigo" exista
python docs/dfd/generar_tm7.py docs/dfd/login-y-sesion.json --mermaid   # bloque para la sección 2 de la ficha
```

Opciones: `--plantilla RUTA` (otra plantilla; sirve cualquier `.tm7` guardado con la versión 4.3), `--salida CARPETA` (escribir en otro lado, útil para probar sin tocar el repo) y `--sin-svg`.

Después de cambiar un JSON se regenera y se suben juntos el `.json`, el `.tm7` y el `.svg`. Los Guid salen de un uuid5 de `feature` + `id`, así que regenerar sin cambios produce el mismo archivo y el diff queda limpio.

## Cómo se traduce cada cosa

| JSON | En la herramienta | Clase en el XML | Tipo elegido |
| --- | --- | --- | --- |
| `actor` | Interactor externo (rectángulo) | `StencilRectangle`, `GE.EI` | `Browser` si el nombre dice navegador; `Authorization Provider` si dice Entra, OAuth u OIDC; `External Web Application` si dice extensión, wallet o Freighter; `External Web Service` si dice API, Stellar, Telegram, Anthropic, GitHub o cron; si no, `Human User` |
| `proceso` | Proceso (círculo) | `StencilEllipse`, `GE.P` | `OS Process` si el código es `.mjs`, `.sh` o está en `scripts/`; `Web Service` si es `route.ts` o `middleware.ts`; si no, `Web Application` |
| `almacen` | Almacén (líneas paralelas) | `StencilParallelLines`, `GE.DS` | `HTML5 Local Storage` si el nombre dice cookie o localStorage; `Cloud Storage` si dice Stellar, ledger, logs o stdout; `Cache` si dice memoria o caché; `Configuration File` si dice archivo, `.md` o `.json`; si no, `SQL Database` |
| `frontera` | Frontera de confianza (rectángulo punteado alrededor de sus elementos) | `BorderBoundary`, `GE.TB.B` | `CorpNet Trust Boundary` |
| `flujo` | Flujo de datos (flecha) | `Connector`, `GE.DF` | `HTTPS` si el protocolo dice HTTPS, Stellar, Telegram, Anthropic, Entra, OAuth, OIDC, GitHub o TLS; `HTTP` si dice HTTP; si no, `Binary` |

La distribución es automática: columnas de izquierda a derecha según la distancia (en saltos) al primer elemento del JSON, una banda horizontal por frontera para que no se monten, y los elementos sin frontera junto a sus vecinos. Conviene poner primero en el JSON a quien inicia la acción.

Los atributos configurables de cada elemento (por ejemplo "Authenticates Itself" o "Contains Cookies") quedan en su valor por defecto. Se ajustan en la herramienta si el análisis lo necesita.

## Qué valida el generador

En cada corrida, antes de escribir:

1. El JSON cumple el esquema: ids únicos, tipos válidos, flujos y fronteras que apuntan a elementos existentes, `sensible` booleano.
2. El `.tm7` es XML bien formado.
3. Todo prefijo usado en un `i:type` (por ejemplo `b:HeaderDisplayAttribute`) está declarado en su ámbito. Es el error que un serializador XML genérico mete sin avisar y que impide abrir el archivo.
4. Cada flujo apunta (`SourceGuid`, `TargetGuid`) a un elemento existente.
5. Los conteos de actores, procesos, almacenes, fronteras y flujos coinciden con el JSON.
6. Los nombres se conservan, los `z:Id` son únicos y consecutivos y no quedan amenazas (`ThreatInstances` vacío; la herramienta las genera al abrir la vista de análisis).
7. La base de conocimiento es idéntica, carácter por carácter, a la de la plantilla.

Además hay una autoprueba del serializador: `--verificar-contra Ejemplo.tm7` vuelve a escribir con este script cada elemento y flujo de un `.tm7` hecho a mano en la herramienta y lo compara byte a byte con el original. El archivo del ejercicio de clase no está en el repo; quien lo tenga lo pasa por ruta.

## Resultado de la validación (21 de octubre de 2026, commit 0e07d8f)

- `--verificar-contra` con el `Ejemplo.tm7` de la clase: 15 estenciles y 48 líneas (32 flujos y 16 fronteras de línea) re-serializados idénticos byte a byte (407.485 caracteres). Esto confirma la forma de `StencilEllipse`, `StencilParallelLines`, `Connector`, `LineBoundary` y de la superficie del diagrama, y la regla con la que se derivan las propiedades desde la base de conocimiento.
- Regeneración del ejemplo de clase desde un JSON equivalente (1 actor, 8 procesos, 5 almacenes, 32 flujos): pasan las 8 comprobaciones y los 32 flujos tienen el mismo origen, destino, nombre y tipo que el original. El "Certificados" duplicado del ejemplo no tiene flujos y no se incluyó.
- `00-sistema.json`: pasan las 8 comprobaciones (7 actores, 8 procesos, 4 almacenes, 2 fronteras, 32 flujos), sin avisos.
- Integración de los 16 features (`python docs/dfd/generar_tm7.py --todos --estricto`): 17 `.tm7` y 17 `.svg` generados, 0 errores. Una comprobación aparte con `grep -F` confirmó los 433 elementos y sus 628 símbolos (`codigo`), y que los 652 flujos apuntan a elementos existentes. El bloque Mermaid de la sección 2 de cada ficha es idéntico a la salida de `--mermaid`.

### Avisos aceptados

El generador avisa de cinco flujos que unen dos actores sin un proceso en medio. Se dejan porque son pasos reales que ocurren fuera del sistema; la herramienta no genera amenazas para ellos, así que la sección 7 de cada ficha los analiza a mano:

| Feature | Flujo | Qué es | Dónde se analiza la amenaza |
| --- | --- | --- | --- |
| `academia` | f10 | El navegador de la persona carga el video embebido directo de YouTube | Sección 7: "El video embebido entrega la IP del visitante a YouTube" (Pendiente) |
| `ritos-y-comunidad` | f10 | El anfitrión muestra el código rotativo en pantalla o en persona | Sección 7: "Registrar asistencia sin estar" (Aceptada) |
| `sitio-publico-y-formularios` | f12 | El visitante abre la transacción en el explorador público de testnet | Sección 2 de la ficha: no pasa por el servidor; datos públicos |
| `telegram` | f7, f25 | La persona escribe y recibe mensajes a través de los servidores de Telegram | Sección 7: "Vincular la cuenta de otra persona adivinando un código" (Mitigada) y el webhook (f8) |

Si alguien prefiere quitarlos, la forma es la del ejemplo de clase: modelar el lado del cliente como proceso (por ejemplo, "Cliente web en el navegador" en `00-sistema.json`).

## Limitaciones

- **La validación final es abrir el `.tm7` en Microsoft Threat Modeling Tool 4.3, que solo corre en Windows.** Las comprobaciones de arriba no la reemplazan. Quien lo abra por primera vez deja anotado aquí el resultado.
- El ejemplo de clase no tiene interactores externos (`StencilRectangle`) ni fronteras de borde (`BorderBoundary`): el "Usuario" del ejemplo es un proceso de tipo Browser Client y sus fronteras son de línea. Esas dos clases siguen la misma regla comprobada, pero su forma exacta no se pudo comparar contra un archivo de la herramienta. Si la herramienta las rechaza, el arreglo está en `xml_borde` y en `BaseConocimiento.propiedades`.
- No se usan los tipos de la base de conocimiento que traen atributos configurables propios (por ejemplo "Cookies", con HTTPOnly, o "File System", con fsType), porque su forma no está comprobada. Por eso una cookie se dibuja como "HTML5 Local Storage" y un archivo como "Configuration File". El generador rechaza esos tipos si se piden con `"tmt"`.
- Lo que se cambie en la herramienta (posiciones, atributos, estado de amenazas) no vuelve al JSON. Para el análisis de amenazas, la ficha (sección 7) es el registro; el `.tm7` es para dibujar y generar la lista inicial.

## Plantilla

`plantilla.tm7` se creó desde el `Ejemplo.tm7` de la clase con:

```bash
python docs/dfd/generar_tm7.py --limpiar-plantilla <ruta>/Ejemplo.tm7 docs/dfd/plantilla.tm7
```

Conserva intacta la base de conocimiento de la herramienta ("SDL TM Knowledge Base (Core)" 4.1.0.11) y quita el diagrama, las 264 amenazas y los datos del modelo. Antes de copiarla se revisó que el ejemplo no trajera datos personales: dueño, revisor, colaboradores y supuestos estaban vacíos, y no había correos ni rutas de equipo. Aun así, la plantilla no lleva los nombres del ejercicio.
