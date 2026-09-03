# WP18 · Capa OKR: objetivos, resultados clave y ciclo de revisión

CONTEXTO — Marco OKR + objetivos SMART aplicados a Zelena. La pieza que faltaba: hoy el sistema mide *actividad* (asignaciones, check-ins, fitness de época) pero no *resultados*. Sin objetivos explícitos, el equipo puede estar muy ocupado avanzando poco.

PROBLEMA — El equipo no sabe contra qué se mide el trimestre, y John no puede distinguir "vamos bien" de "vamos rápido en la dirección equivocada".

RESULTADO ESPERADO — Cada trimestre tiene 2–3 objetivos con resultados clave numéricos; cada asignación puede enlazarse a un resultado clave; el avance se ve sin pedirlo.

## Alcance

### Modelo
- `objectives`: `title, description, quarter (2026-Q3), owner_id, status (planning|en curso|logrado|no logrado), horizon (corto 2-8 sem | medio 3-6 m | largo 6-24 m)`.
- `key_results`: `objective_id, title, baseline, target, current, unit, updated_at, updated_by`. El avance es `(current − baseline) / (target − baseline)`.
- `assignments.key_result_id` (nullable): conecta el trabajo diario con el resultado que persigue. **Nullable a propósito**: obligar a que todo tribute a un OKR produce OKRs falsos.

### Vistas
- `/okr` — objetivos del trimestre con barra de avance por resultado clave, responsable y última actualización. Visible para todo el equipo (transparencia = legitimidad).
- En `/equipo/hoy`: si la asignación tributa a un resultado clave, se muestra ("esto mueve: reducir tiempo de despliegue a <1 semana").
- En el dashboard (WP15): bloque de OKRs del trimestre arriba, junto a bloqueos.
- **Resultados clave sin actualizar hace >14 días se marcan como obsoletos** — un OKR que nadie actualiza es un OKR muerto, y verlo es la señal.

### Ciclo de revisión (rituales, no reuniones nuevas)
Se apoya en lo que ya existe, sin añadir ceremonias:

| Cadencia | Dónde ocurre | Qué se revisa |
|---|---|---|
| Diaria | Check-in de WP14 | Bloqueos |
| Semanal | Weekly gate del playbook | Avance de resultados clave de corto plazo |
| Por época (quincenal) | Cierre de época (WP07) | Fitness + actualización de los `current` |
| Trimestral | Retro + auditoría de funciones latentes (WP12) | Cierre de objetivos, definición del trimestre siguiente |

### Plantilla al crear un objetivo (validación SMART en el formulario)
El formulario exige: qué específicamente · cómo se mide (baseline → target con unidad) · por qué es alcanzable · con qué se relaciona (valor al cliente o al negocio) · para cuándo. Si falta baseline o target numérico, no se puede guardar: **un objetivo sin número es un deseo.**

## NO-ALCANCE
- Cálculo automático de `current` desde otras fuentes (v2: algunos vendrán de métricas del sistema).
- OKRs individuales por persona (son de equipo/organización — los OKRs personales degeneran en evaluación de personas, prohibido por la regla del doc 16).
- Ponderaciones, scoring de OKRs, cascadas de OKRs entre niveles.

## CRITERIOS DE ACEPTACIÓN
- [ ] Crear objetivo sin baseline/target numérico es imposible (test de validación).
- [ ] Avance calculado correcto, incluido el caso de métricas que bajan (reducir errores: target < baseline).
- [ ] Resultado clave sin actualizar >14 días aparece marcado como obsoleto.
- [ ] Una asignación enlazada muestra su resultado clave en `/equipo/hoy`.
- [ ] Copys revisados: los OKRs miden resultados de la organización, nunca desempeño de personas.

OWNER — Dev 2 · HUMANO (John): define los OKRs del trimestre — el sistema no los inventa.
TAMAÑO — M · Estimado: 1 día. Depende: WP14, WP15.
