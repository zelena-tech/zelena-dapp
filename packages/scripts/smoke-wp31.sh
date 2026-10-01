#!/usr/bin/env bash
# Smoke del WP31 contra un despliegue (spec WP31 §9 "Smoke", criterio E2-6).
#
#   bash packages/scripts/smoke-wp31.sh https://www.zelena.tech
#   SIN_CRON=1 SIN_COMUNIDAD=1 bash packages/scripts/smoke-wp31.sh <base-url>
#
#   SIN_CRON=1        omite la ruta del cron (si los recordatorios no salieron a la hora de corte).
#   SIN_COMUNIDAD=1   omite /comunidad (si los ritos no salieron a la hora de corte) y, a
#                     cambio, exige que ninguna página pública la enlace: con RUTA_COMUNIDAD
#                     aún en "/comunidad", el menú, la puerta y los CTA darían 404.
#
# Usa el host canónico (con www): si la base redirige a otro host, las rutas no dan 200.
#
# No usa ni necesita secretos: la ruta del cron solo se prueba SIN cabecera (debe
# responder 401). Solo hace GET, salvo ese POST sin credenciales. Sale con 0 si todo
# pasa y con 1 si algo falla (lista cada falla).
set -u

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "Uso: bash $0 <base-url>   (p. ej. https://www.zelena.tech)" >&2
  exit 2
fi
BASE="${BASE%/}"

SIN_CRON="${SIN_CRON:-0}"
SIN_COMUNIDAD="${SIN_COMUNIDAD:-0}"

# Hash del texto del acuerdo de contribución (CLA.md). Las firmas reales lo usan.
HASH_CLA="03293c9378146cbd7fcbd49a0df467134a118d7a7e0379664c5d069c0398edb9"

# Rutas que deben responder 200.
RUTAS_200="/ /metodo /comunidad /manifiesto /encuentros /empresas /privacidad /acuerdo /agora /academia /academia/construir-sin-riesgo /whitepaper /gobernanza"

# Rutas públicas que no pueden nombrar la estructura societaria. Fuera de la lista, a
# propósito, las excepciones legales (spec §2.5): /acuerdo, /entrar, /gobernanza y /privacidad.
RUTAS_SIN_ESTRUCTURA="/ /metodo /comunidad /agora /academia /academia/construir-sin-riesgo /whitepaper /empresas /encuentros"
PATRON_ESTRUCTURA='\bSAS\b|S\.A\.S|societari|sociedad'

# Prueba en vivo de la landing: un enlace a una transacción verificable de testnet.
PATRON_TX='stellar\.expert/explorer/testnet/tx/[0-9a-f]{64}'

# Con SIN_COMUNIDAD=1, un enlace a /comunidad (o a /comunidad/..., ?..., #...) es un 404.
PATRON_ENLACE_COMUNIDAD='href="/comunidad[/?#"]'

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t smoke-wp31)"
trap 'rm -rf "$TMP"' EXIT

fallas=0
ok() { printf '  ok     %s\n' "$1"; }
falla() { printf '  FALLA  %s\n' "$1"; fallas=$((fallas + 1)); }
omitida() { printf '  omite  %s\n' "$1"; }

# archivo de la ruta (para no descargar dos veces la misma página)
archivo_de() { printf '%s/pagina%s.html' "$TMP" "$(printf '%s' "$1" | tr '/' '_')"; }

# GET sin seguir redirecciones; guarda el cuerpo y escribe "código destino".
pedir() {
  curl -s --max-time 30 -o "$2" -w '%{http_code} %{redirect_url}' "$BASE$1" 2>/dev/null || true
}

omitir_ruta() {
  [ "$1" = "/comunidad" ] && [ "$SIN_COMUNIDAD" = "1" ]
}

echo "Smoke WP31 contra $BASE"

echo "1. Páginas públicas en 200"
for ruta in $RUTAS_200; do
  if omitir_ruta "$ruta"; then omitida "$ruta (SIN_COMUNIDAD=1)"; continue; fi
  pagina="$(archivo_de "$ruta")"
  resp="$(pedir "$ruta" "$pagina")"
  codigo="${resp%% *}"
  if [ "$codigo" = "200" ]; then
    ok "$ruta 200"
  else
    falla "$ruta respondió $codigo (se esperaba 200)"
    # Una página de error no cuenta como página limpia en los pasos 6 y 7.
    rm -f "$pagina"
  fi
done

echo "2. Redirecciones permanentes (308)"
for par in "/ecosistema /metodo" "/academia/por-que-sas-dao /academia/construir-sin-riesgo"; do
  origen="${par%% *}"
  destino="${par##* }"
  resp="$(pedir "$origen" "$TMP/redir.html")"
  codigo="${resp%% *}"
  url="${resp#* }"
  case "$url" in
    *"$destino") ruta_ok=1 ;;
    *) ruta_ok=0 ;;
  esac
  if [ "$codigo" = "308" ] && [ "$ruta_ok" = "1" ]; then
    ok "$origen 308 → $destino"
  else
    falla "$origen respondió $codigo hacia '$url' (se esperaba 308 → $destino)"
  fi
done

echo "3. /equipo/hoy sin sesión lleva a /entrar"
resp="$(pedir "/equipo/hoy" "$TMP/equipo.html")"
codigo="${resp%% *}"
url="${resp#* }"
case "$codigo" in
  30[12378])
    case "$url" in
      */entrar*) ok "/equipo/hoy $codigo → /entrar" ;;
      *) falla "/equipo/hoy redirige a '$url' (se esperaba /entrar)" ;;
    esac
    ;;
  *) falla "/equipo/hoy respondió $codigo sin sesión (se esperaba una redirección a /entrar)" ;;
esac

echo "4. Cron de recordatorios sin cabecera → 401"
if [ "$SIN_CRON" = "1" ]; then
  omitida "POST /api/cron/recordatorios (SIN_CRON=1)"
else
  codigo="$(curl -s --max-time 30 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/cron/recordatorios" 2>/dev/null || true)"
  if [ "$codigo" = "401" ]; then ok "POST /api/cron/recordatorios 401"; else falla "POST /api/cron/recordatorios respondió $codigo (se esperaba 401)"; fi
fi

echo "5. Hash del acuerdo de contribución en /api/cla"
resp="$(pedir "/api/cla" "$TMP/cla.json")"
codigo="${resp%% *}"
if [ "$codigo" = "200" ] && grep -q "$HASH_CLA" "$TMP/cla.json"; then
  ok "/api/cla sirve el hash ${HASH_CLA:0:8}…"
else
  falla "/api/cla respondió $codigo sin el hash ${HASH_CLA:0:8}…"
fi

echo "6. La landing enlaza una transacción verificable de testnet"
landing="$(archivo_de "/")"
if [ -s "$landing" ] && grep -Eq "$PATRON_TX" "$landing"; then
  ok "/ enlaza stellar.expert/explorer/testnet/tx/<64 hex>"
else
  falla "/ no enlaza ninguna transacción de stellar.expert/explorer/testnet/tx/<64 hex>"
fi

echo "7. Sin estructura societaria en las páginas públicas"
for ruta in $RUTAS_SIN_ESTRUCTURA; do
  if omitir_ruta "$ruta"; then omitida "$ruta (SIN_COMUNIDAD=1)"; continue; fi
  pagina="$(archivo_de "$ruta")"
  if [ ! -s "$pagina" ]; then falla "$ruta: no se pudo revisar (no respondió 200 en el paso 1)"; continue; fi
  n="$(grep -cE "$PATRON_ESTRUCTURA" "$pagina" || true)"
  if [ "${n:-0}" = "0" ]; then ok "$ruta 0 menciones"; else falla "$ruta: $n línea(s) casan con '$PATRON_ESTRUCTURA'"; fi
done

echo "8. Sin /comunidad desplegada, ninguna página la enlaza"
if [ "$SIN_COMUNIDAD" = "1" ]; then
  # Revisa lo que bajó el paso 1 (menú, puerta de la landing, CTA y próximo encuentro).
  for ruta in $RUTAS_200; do
    if omitir_ruta "$ruta"; then continue; fi
    pagina="$(archivo_de "$ruta")"
    if [ ! -s "$pagina" ]; then falla "$ruta: no se pudo revisar (no respondió 200 en el paso 1)"; continue; fi
    n="$(grep -cE "$PATRON_ENLACE_COMUNIDAD" "$pagina" || true)"
    if [ "${n:-0}" = "0" ]; then
      ok "$ruta no enlaza /comunidad"
    else
      falla "$ruta enlaza /comunidad con SIN_COMUNIDAD=1 (cambia RUTA_COMUNIDAD a \"/encuentros\" en src/lib/menu.ts)"
    fi
  done
else
  omitida "no aplica: sin SIN_COMUNIDAD=1, el paso 1 exige /comunidad en 200"
fi

echo
if [ "$fallas" -eq 0 ]; then
  echo "Smoke WP31 en verde."
  exit 0
fi
echo "Smoke WP31 con $fallas falla(s)."
exit 1
