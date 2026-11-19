#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generar_tm7.py: convierte la fuente de un DFD (docs/dfd/<feature>.json) en un
modelo de Microsoft Threat Modeling Tool 4.3 (docs/dfd/<feature>.tm7).

Solo usa la biblioteca estándar de Python 3 (probado con 3.10).

Uso
---
  python docs/dfd/generar_tm7.py docs/dfd/00-sistema.json         # un diagrama
  python docs/dfd/generar_tm7.py --todos                          # todos los docs/dfd/*.json
  python docs/dfd/generar_tm7.py X.json --plantilla OTRA.tm7      # otra plantilla
  python docs/dfd/generar_tm7.py X.json --salida /tmp/dfd         # otra carpeta de salida
  python docs/dfd/generar_tm7.py X.json --estricto                # avisos de código = error
  python docs/dfd/generar_tm7.py X.json --mermaid                 # bloque Mermaid para la ficha
  python docs/dfd/generar_tm7.py X.json --sin-svg                 # sin la imagen .svg

Herramientas de mantenimiento (no hacen falta para el trabajo diario):
  --verificar-contra Ejemplo.tm7
      Autoprueba del serializador: vuelve a escribir, con este script, cada
      elemento y flujo del diagrama de un .tm7 hecho a mano en la herramienta y
      compara el XML byte a byte con el original.
  --limpiar-plantilla Ejemplo.tm7 docs/dfd/plantilla.tm7
      Crea la plantilla del repo a partir de un .tm7 de la herramienta: deja la
      base de conocimiento intacta y quita el diagrama, las amenazas y los datos
      del modelo.

Qué hace
--------
1. Valida el JSON (esquema de docs/dfd/README.md): ids únicos, tipos válidos,
   flujos y fronteras que apuntan a elementos existentes y, como aviso, que el
   archivo y el símbolo de cada campo "codigo" existan en el repo.
2. Toma de la plantilla todo lo que no es el diagrama (la base de conocimiento
   "SDL TM Knowledge Base (Core)" va intacta) y escribe:
   - actor    -> StencilRectangle     (GE.EI, interactor externo)
   - proceso  -> StencilEllipse       (GE.P)
   - almacen  -> StencilParallelLines (GE.DS)
   - frontera -> BorderBoundary       (GE.TB.B, rectángulo alrededor de sus elementos)
   - flujo    -> Connector            (GE.DF, con SourceGuid/TargetGuid)
   Las propiedades de cada estencil se derivan de la base de conocimiento con
   la misma regla que usa la herramienta (ver --verificar-contra).
3. Guid nuevos y estables (uuid5 de feature + id): regenerar no ensucia el diff.
4. Distribuye los elementos en columnas de izquierda a derecha (distancia en
   saltos desde el primer elemento del JSON) y en bandas horizontales, una por
   frontera, para que los rectángulos de las fronteras no se monten. Lo que no
   está en ninguna frontera se coloca junto a sus vecinos, fuera de las fronteras.
5. No escribe amenazas: ThreatInstances queda vacío y la herramienta las genera
   al abrir la vista de análisis.
6. Valida el resultado: el XML parsea, todo prefijo usado en i:type está
   declarado, cada flujo apunta a elementos existentes, los conteos coinciden con
   el JSON, los z:Id son únicos y la base de conocimiento es idéntica a la de la
   plantilla.
7. Escribe además docs/dfd/<feature>.svg con el mismo dibujo (la "imagen
   exportada" que pide la guía; se ve sin Windows). --sin-svg lo omite.

La validación final es abrir el .tm7 en Microsoft Threat Modeling Tool 4.3
(solo Windows). Ver docs/dfd/README.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
import xml.etree.ElementTree as ET
import xml.parsers.expat
from collections import deque
from pathlib import Path
from xml.sax.saxutils import escape as _escape

AQUI = Path(__file__).resolve().parent
RAIZ_REPO = AQUI.parent.parent
PLANTILLA_POR_DEFECTO = AQUI / "plantilla.tm7"

# --- Espacios de nombres del DataContract de la herramienta -----------------
NS_MODELO = "http://schemas.datacontract.org/2004/07/ThreatModeling.Model"
NS_ABS = "http://schemas.datacontract.org/2004/07/ThreatModeling.Model.Abstracts"
NS_KB = "http://schemas.datacontract.org/2004/07/ThreatModeling.KnowledgeBase"
NS_ARR = "http://schemas.microsoft.com/2003/10/Serialization/Arrays"
NS_SER = "http://schemas.microsoft.com/2003/10/Serialization/"
NS_XSD = "http://www.w3.org/2001/XMLSchema"
NS_XSI = "http://www.w3.org/2001/XMLSchema-instance"

ABS = f'xmlns="{NS_ABS}"'
DECL_B = f'xmlns:b="{NS_KB}"'
DECL_C = f'xmlns:c="{NS_XSD}"'

# Propiedades que la herramienta añade a todo estencil y que no están en la base
# de conocimiento (mismos Guid que en cualquier .tm7 de la versión 4.3).
ID_FUERA_DE_ALCANCE = "71f3d9aa-b8ef-4e54-8126-607a1d903103"
ID_RAZON_FUERA = "752473b6-52d4-4776-9a24-202153f7d579"
ID_ORDEN_FLUJO = "15ccd509-98eb-49ad-b9c2-b4a2926d1780"
GUID_NULO = "00000000-0000-0000-0000-000000000000"

# Espacio para los uuid5: los Guid salen nuevos (no son los de la plantilla) y
# estables entre corridas.
ESPACIO_GUID = uuid.UUID("5b0f3c1e-7d2a-4f4e-9a51-0c6d2e8f7a10")

TIPOS = ("actor", "proceso", "almacen")
GENERICO_POR_TIPO = {"actor": "GE.EI", "proceso": "GE.P", "almacen": "GE.DS"}
CLASE_POR_GENERICO = {
    "GE.P": "StencilEllipse",
    "GE.EI": "StencilRectangle",
    "GE.DS": "StencilParallelLines",
    "GE.TB.B": "BorderBoundary",
    "GE.DF": "Connector",
    "GE.TB.L": "LineBoundary",
}
SIN_FUERA_DE_ALCANCE = {"GE.TB.L", "GE.TB.B", "GE.A"}

# Geometría (unidades de la herramienta, ~píxeles).
ANCHO = ALTO = 100
PASO_X = 330
PASO_Y = 190
MARGEN_X = 90
MARGEN_Y = 100
HUECO_BANDA = 80
RELLENO = 40
RELLENO_SUP = 55  # deja sitio para el nombre de la frontera
# Puntos de anclaje de un estencil de 100x100 (medidos en el ejemplo de clase).
PUERTOS = {
    "East": (95, 50),
    "West": (5, 50),
    "North": (50, 5),
    "South": (50, 95),
}


class ErrorModelo(Exception):
    """El JSON no cumple el esquema o la plantilla no sirve."""


# ---------------------------------------------------------------------------
# Utilidades de texto
# ---------------------------------------------------------------------------
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def esc(texto: str) -> str:
    """Escapa texto para el contenido de un elemento XML 1.0 (retorno de carro como &#xD;, igual que .NET)."""
    return _escape(_CONTROL.sub("", str(texto))).replace("\r", "&#xD;")


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def hijo(elem: ET.Element, nombre: str) -> ET.Element | None:
    for c in elem:
        if local(c.tag) == nombre:
            return c
    return None


def texto_de(elem: ET.Element, nombre: str, defecto: str = "") -> str:
    c = hijo(elem, nombre)
    return c.text if c is not None and c.text is not None else defecto


def recortar(texto: str, inicio: str, fin: str, desde: int = 0) -> tuple[int, int]:
    """Posiciones [i, j) del primer bloque que empieza con `inicio` y cierra con `fin`."""
    i = texto.find(inicio, desde)
    if i < 0:
        raise ErrorModelo(f"la plantilla no tiene {inicio!r}")
    j = texto.find(fin, i)
    if j < 0:
        raise ErrorModelo(f"la plantilla no cierra {inicio!r}")
    return i, j + len(fin)


# ---------------------------------------------------------------------------
# Base de conocimiento (se lee de la plantilla, nunca se modifica)
# ---------------------------------------------------------------------------
class Atributo:
    def __init__(self, nombre: str, visible: str, modo: str, valores: list[str]):
        self.nombre = nombre
        self.visible = visible
        self.modo = modo
        self.valores = valores


class TipoKB:
    def __init__(self, ident: str, nombre: str, padre: str, atributos: list[Atributo]):
        self.id = ident
        self.nombre = nombre
        self.padre = padre
        self.atributos = atributos


class BaseConocimiento:
    def __init__(self, raiz: ET.Element):
        kb = hijo(raiz, "KnowledgeBase")
        if kb is None:
            raise ErrorModelo("la plantilla no trae KnowledgeBase")
        self.tipos: dict[str, TipoKB] = {}
        for seccion in ("GenericElements", "StandardElements"):
            sec = hijo(kb, seccion)
            if sec is None:
                raise ErrorModelo(f"la base de conocimiento no trae {seccion}")
            for et in sec:
                attrs = []
                cont = hijo(et, "Attributes")
                for a in (cont if cont is not None else []):
                    vals = hijo(a, "AttributeValues")
                    attrs.append(
                        Atributo(
                            texto_de(a, "Name"),
                            texto_de(a, "DisplayName"),
                            texto_de(a, "Mode"),
                            [v.text or "" for v in (vals if vals is not None else [])],
                        )
                    )
                t = TipoKB(texto_de(et, "Id"), texto_de(et, "Name"), texto_de(et, "ParentId"), attrs)
                self.tipos[t.id] = t

    def generico(self, type_id: str) -> TipoKB:
        t = self.tipo(type_id)
        return t if t.padre == "ROOT" else self.tipo(t.padre)

    def tipo(self, type_id: str) -> TipoKB:
        if type_id not in self.tipos:
            raise ErrorModelo(f"el tipo {type_id!r} no existe en la base de conocimiento de la plantilla")
        return self.tipos[type_id]

    def propiedades(
        self,
        type_id: str,
        nombre: str,
        indices: dict[str, int] | None = None,
        orden_flujo: str = "0",
        fuera_de_alcance: str = "false",
        razon: str = "",
    ) -> str:
        """
        Serializa la lista <Properties> de un estencil igual que la herramienta:
          cabecera con el nombre del tipo, Name, [Dataflow Order], [Out Of Scope,
          Reason For Out Of Scope], [Predefined Static Attributes + atributos
          estáticos del tipo estándar], Configurable Attributes, "As <genérico>" y
          los atributos dinámicos del genérico que el estándar no fija.
        Regla comprobada contra el ejemplo de clase con --verificar-contra.
        """
        indices = indices or {}
        se = self.tipo(type_id)
        ge = self.generico(type_id)
        estaticos = [a for a in se.atributos if a.modo == "Static"] if se is not ge else []
        dinamicos_propios = [a for a in se.atributos if a.modo != "Static"] if se is not ge else []
        if dinamicos_propios:
            raise ErrorModelo(
                f"el tipo {type_id} trae atributos configurables propios; este generador no los soporta. "
                "Usa otro tipo de la herramienta."
            )
        partes = [_cabecera(se.nombre), _cadena("Name", "", nombre)]
        if ge.id == "GE.DF":
            partes.append(_cadena("Dataflow Order", ID_ORDEN_FLUJO, orden_flujo))
        if ge.id not in SIN_FUERA_DE_ALCANCE:
            partes.append(
                f'<a:anyType i:type="b:BooleanDisplayAttribute" {DECL_B}><b:DisplayName>Out Of Scope</b:DisplayName>'
                f'<b:Name>{ID_FUERA_DE_ALCANCE}</b:Name><b:Value i:type="c:boolean" {DECL_C}>{fuera_de_alcance}</b:Value></a:anyType>'
            )
            partes.append(_cadena("Reason For Out Of Scope", ID_RAZON_FUERA, razon))
        if estaticos:
            partes.append(_cabecera("Predefined Static Attributes"))
            for a in estaticos:
                partes.append(_lista("StaticListDisplayAttribute", a.visible, a.nombre, a.valores, 0))
        partes.append(_cabecera("Configurable Attributes"))
        partes.append(_cabecera("As " + ge.nombre))
        fijos = {a.nombre for a in estaticos}
        for a in ge.atributos:
            if a.nombre in fijos:
                continue
            partes.append(_lista("ListDisplayAttribute", a.visible, a.nombre, a.valores, indices.get(a.nombre, 0)))
        return "".join(partes)


def _cabecera(texto: str) -> str:
    return (
        f'<a:anyType i:type="b:HeaderDisplayAttribute" {DECL_B}><b:DisplayName>{esc(texto)}</b:DisplayName>'
        f'<b:Name/><b:Value i:nil="true"/></a:anyType>'
    )


def _cadena(visible: str, nombre: str, valor: str) -> str:
    n = f"<b:Name>{nombre}</b:Name>" if nombre else "<b:Name/>"
    v = (
        f'<b:Value i:type="c:string" {DECL_C}>{esc(valor)}</b:Value>'
        if valor
        else f'<b:Value i:type="c:string" {DECL_C}/>'
    )
    return f'<a:anyType i:type="b:StringDisplayAttribute" {DECL_B}><b:DisplayName>{esc(visible)}</b:DisplayName>{n}{v}</a:anyType>'


def _lista(clase: str, visible: str, nombre: str, valores: list[str], indice: int) -> str:
    vals = "".join(f"<a:string>{esc(v)}</a:string>" if v else "<a:string/>" for v in valores)
    return (
        f'<a:anyType i:type="b:{clase}" {DECL_B}><b:DisplayName>{esc(visible)}</b:DisplayName>'
        f'<b:Name>{esc(nombre)}</b:Name><b:Value i:type="a:ArrayOfstring">{vals}</b:Value>'
        f"<b:SelectedIndex>{indice}</b:SelectedIndex></a:anyType>"
    )


# ---------------------------------------------------------------------------
# Serialización de estenciles, flujos y superficie
# ---------------------------------------------------------------------------
def xml_borde(zid, clase, generico, guid, props, type_id, x, y, ancho, alto, grosor) -> str:
    return (
        f'<a:KeyValueOfguidanyType><a:Key>{guid}</a:Key><a:Value z:Id="i{zid}" i:type="{clase}">'
        f"<GenericTypeId {ABS}>{generico}</GenericTypeId><Guid {ABS}>{guid}</Guid>"
        f"<Properties {ABS}>{props}</Properties><TypeId {ABS}>{type_id}</TypeId>"
        f"<Height {ABS}>{alto}</Height><Left {ABS}>{x}</Left>"
        f'<StrokeDashArray i:nil="true" {ABS}/><StrokeThickness {ABS}>{grosor}</StrokeThickness>'
        f"<Top {ABS}>{y}</Top><Width {ABS}>{ancho}</Width></a:Value></a:KeyValueOfguidanyType>"
    )


def xml_linea(zid, clase, generico, guid, props, type_id, hx, hy, p_origen, p_destino, g_origen, ox, oy, g_destino, dx, dy) -> str:
    return (
        f'<a:KeyValueOfguidanyType><a:Key>{guid}</a:Key><a:Value z:Id="i{zid}" i:type="{clase}">'
        f"<GenericTypeId {ABS}>{generico}</GenericTypeId><Guid {ABS}>{guid}</Guid>"
        f"<Properties {ABS}>{props}</Properties><TypeId {ABS}>{type_id}</TypeId>"
        f"<HandleX {ABS}>{hx}</HandleX><HandleY {ABS}>{hy}</HandleY>"
        f"<PortSource {ABS}>{p_origen}</PortSource><PortTarget {ABS}>{p_destino}</PortTarget>"
        f"<SourceGuid {ABS}>{g_origen}</SourceGuid><SourceX {ABS}>{ox}</SourceX><SourceY {ABS}>{oy}</SourceY>"
        f"<TargetGuid {ABS}>{g_destino}</TargetGuid><TargetX {ABS}>{dx}</TargetX><TargetY {ABS}>{dy}</TargetY>"
        f"</a:Value></a:KeyValueOfguidanyType>"
    )


def xml_superficie(guid: str, titulo: str, bordes: str, lineas: str) -> str:
    props = (
        f'<a:anyType i:type="b:HeaderDisplayAttribute" {DECL_B}><b:DisplayName>Diagram</b:DisplayName>'
        f'<b:Name/><b:Value i:nil="true"/></a:anyType>'
        f'<a:anyType i:type="b:StringDisplayAttribute" {DECL_B}><b:DisplayName>Name</b:DisplayName>'
        f'<b:Name>Name</b:Name><b:Value i:type="c:string" {DECL_C}>{esc(titulo)}</b:Value></a:anyType>'
    )
    return (
        f'<DrawingSurfaceList><DrawingSurfaceModel z:Id="i1" xmlns:z="{NS_SER}">'
        f"<GenericTypeId {ABS}>DRAWINGSURFACE</GenericTypeId><Guid {ABS}>{guid}</Guid>"
        f'<Properties {ABS} xmlns:a="{NS_ARR}">{props}</Properties><TypeId {ABS}>DRAWINGSURFACE</TypeId>'
        f'<Borders xmlns:a="{NS_ARR}">{bordes}</Borders><Header>{esc(titulo)}</Header>'
        f'<Lines xmlns:a="{NS_ARR}">{lineas}</Lines><Zoom>1</Zoom></DrawingSurfaceModel></DrawingSurfaceList>'
    )


def xml_meta(titulo: str, descripcion: str, supuestos: str, dependencias: str) -> str:
    def campo(nombre: str, valor: str) -> str:
        return f"<{nombre}>{esc(valor)}</{nombre}>" if valor else f"<{nombre}/>"

    return (
        "<MetaInformation>"
        + campo("Assumptions", supuestos)
        + "<Contributors/>"
        + campo("ExternalDependencies", dependencias)
        + campo("HighLevelSystemDescription", descripcion)
        + "<Owner/><Reviewer/>"
        + campo("ThreatModelName", titulo)
        + "</MetaInformation>"
    )


# ---------------------------------------------------------------------------
# Plantilla
# ---------------------------------------------------------------------------
class Plantilla:
    def __init__(self, ruta: Path):
        self.ruta = ruta
        self.texto = ruta.read_text(encoding="utf-8-sig")
        try:
            self.raiz = ET.fromstring(self.texto)
        except ET.ParseError as e:
            raise ErrorModelo(f"la plantilla {ruta} no es XML válido: {e}") from e
        if self.raiz.tag != f"{{{NS_MODELO}}}ThreatModel":
            raise ErrorModelo(f"la plantilla {ruta} no es un ThreatModel de la herramienta")
        version = texto_de(self.raiz, "Version")
        if version != "4.3":
            print(f"  aviso: la plantilla es de la versión {version!r}, no 4.3", file=sys.stderr)
        self.kb = BaseConocimiento(self.raiz)
        self.kb_texto = self.texto[slice(*recortar(self.texto, "<KnowledgeBase", "</KnowledgeBase>"))]

    def componer(self, superficie: str, meta: str, siguiente_zid: int) -> str:
        t = self.texto
        s0, s1 = recortar(t, "<DrawingSurfaceList>", "</DrawingSurfaceList>")
        m0, m1 = recortar(t, "<MetaInformation>", "</MetaInformation>")
        a0 = t.find("<ThreatInstances", m1)
        if a0 < 0:
            raise ErrorModelo("la plantilla no tiene ThreatInstances")
        cierre = t.find("</ThreatInstances>", a0)
        fin_tag = t.find(">", a0)
        a1 = fin_tag + 1 if t[fin_tag - 1] == "/" else cierre + len("</ThreatInstances>")
        if not (s1 <= m0 < m1 <= a0):
            raise ErrorModelo("la plantilla no sigue el orden DrawingSurfaceList, MetaInformation, ThreatInstances")
        resto = t[a1:]
        resto, n = re.subn(r'<KnowledgeBase z:Id="i\d+"', f'<KnowledgeBase z:Id="i{siguiente_zid}"', resto, count=1)
        if n != 1:
            raise ErrorModelo("la plantilla no trae KnowledgeBase con z:Id")
        vacio = f'<ThreatInstances xmlns:a="{NS_ARR}"/>'
        return t[:s0] + superficie + t[s1:m0] + meta + t[m1:a0] + vacio + resto


# ---------------------------------------------------------------------------
# Modelo JSON
# ---------------------------------------------------------------------------
def cargar_modelo(ruta: Path) -> dict:
    try:
        modelo = json.loads(ruta.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as e:
        raise ErrorModelo(f"{ruta.name}: JSON inválido: {e}") from e
    errores: list[str] = []

    def exige(obj, claves, donde):
        for c in claves:
            if c not in obj:
                errores.append(f"{donde}: falta el campo {c!r}")

    if not isinstance(modelo, dict):
        raise ErrorModelo(f"{ruta.name}: la raíz debe ser un objeto")
    exige(modelo, ("feature", "titulo", "commit", "elementos", "flujos", "fronteras"), "raíz")
    if errores:
        raise ErrorModelo(f"{ruta.name}: " + "; ".join(errores))
    ids: dict[str, dict] = {}
    for n, e in enumerate(modelo["elementos"]):
        donde = f"elementos[{n}]"
        exige(e, ("id", "tipo", "nombre", "codigo"), donde)
        if e.get("tipo") not in TIPOS:
            errores.append(f"{donde}: tipo {e.get('tipo')!r} no es actor | proceso | almacen")
        if e.get("id") in ids:
            errores.append(f"{donde}: id repetido {e.get('id')!r}")
        ids[e.get("id")] = e
    if not modelo["elementos"]:
        errores.append("elementos: está vacío")
    flujos_ids = set()
    for n, f in enumerate(modelo["flujos"]):
        donde = f"flujos[{n}]"
        exige(f, ("id", "de", "a", "nombre", "protocolo", "datos", "sensible"), donde)
        if f.get("id") in flujos_ids or f.get("id") in ids:
            errores.append(f"{donde}: id repetido {f.get('id')!r}")
        flujos_ids.add(f.get("id"))
        for extremo in ("de", "a"):
            if f.get(extremo) not in ids:
                errores.append(f"{donde}: {extremo!r} apunta a {f.get(extremo)!r}, que no está en elementos")
        if f.get("de") == f.get("a"):
            errores.append(f"{donde}: un flujo no puede salir y llegar al mismo elemento")
        if not isinstance(f.get("sensible"), bool):
            errores.append(f"{donde}: 'sensible' debe ser true o false")
    for n, fr in enumerate(modelo["fronteras"]):
        donde = f"fronteras[{n}]"
        exige(fr, ("nombre", "contiene"), donde)
        for c in fr.get("contiene", []):
            if c not in ids:
                errores.append(f"{donde}: contiene {c!r}, que no está en elementos")
        if not fr.get("contiene"):
            errores.append(f"{donde}: no contiene elementos")
    if errores:
        raise ErrorModelo(f"{ruta.name}:\n  - " + "\n  - ".join(errores))
    return modelo


def avisos_de_modelo(modelo: dict, ruta: Path) -> list[str]:
    """Comprobaciones que no impiden generar: reglas del DFD y ubicación en el código."""
    avisos = []
    if modelo["feature"] != ruta.stem:
        avisos.append(f"'feature' ({modelo['feature']!r}) no coincide con el nombre del archivo ({ruta.stem!r})")
    tipos = {e["id"]: e["tipo"] for e in modelo["elementos"]}
    for f in modelo["flujos"]:
        par = (tipos[f["de"]], tipos[f["a"]])
        if "proceso" not in par:
            avisos.append(f"flujo {f['id']}: {par[0]} -> {par[1]} sin proceso en medio (regla de DFD)")
    usados = {f["de"] for f in modelo["flujos"]} | {f["a"] for f in modelo["flujos"]}
    for e in modelo["elementos"]:
        if e["id"] not in usados:
            avisos.append(f"elemento {e['id']}: no participa en ningún flujo")
    vistos: dict[str, str] = {}
    for fr in modelo["fronteras"]:
        for c in fr["contiene"]:
            if c in vistos:
                avisos.append(f"elemento {c}: está en dos fronteras ({vistos[c]!r} y {fr['nombre']!r}); se dibuja en la primera")
            else:
                vistos[c] = fr["nombre"]
    for e in modelo["elementos"]:
        avisos.extend(verificar_codigo(e))
    return avisos


def verificar_codigo(elem: dict) -> list[str]:
    """'codigo' = '<archivo>#<símbolo>[, <símbolo>...]'. El archivo debe existir y el símbolo aparecer en él."""
    codigo = str(elem.get("codigo", "")).strip()
    if "#" not in codigo:
        return [f"código: elemento {elem['id']}: 'codigo' sin '#<función o componente>' ({codigo!r})"]
    archivo, simbolos = codigo.split("#", 1)
    archivo = archivo.strip().replace("\\", "/")
    candidatos = [RAIZ_REPO / archivo, RAIZ_REPO / "apps/web" / archivo, RAIZ_REPO / "apps/web/src" / archivo]
    ruta = next((c for c in candidatos if c.is_file()), None)
    if ruta is None:
        return [f"código: elemento {elem['id']}: el archivo {archivo!r} no existe en el repo"]
    contenido = ruta.read_text(encoding="utf-8", errors="replace")
    faltan = [s for s in re.split(r"[,;+\s]+", simbolos) if s and s not in contenido]
    if faltan:
        return [f"código: elemento {elem['id']}: {', '.join(faltan)} no aparece en {archivo}"]
    return []


# ---------------------------------------------------------------------------
# Tipo de la herramienta para cada elemento y flujo
# ---------------------------------------------------------------------------
def tipo_tmt(elem: dict, kb: BaseConocimiento) -> str:
    """
    Tipo estándar de la herramienta para un elemento. Se decide por el NOMBRE
    (las rutas de código engañan: "app/api" contiene "api") salvo en procesos,
    donde manda el archivo. 'tmt' en el JSON lo fija a mano (opcional).

    Solo se usan tipos cuyos atributos son todos estáticos, porque esa forma de
    serializar está comprobada byte a byte contra el ejemplo de clase. Por eso las
    cookies se dibujan como "HTML5 Local Storage" (el tipo "Cookies" trae el
    atributo configurable HTTPOnly) y los archivos como "Configuration File"
    (el tipo "File System" trae fsType).
    """
    generico = GENERICO_POR_TIPO[elem["tipo"]]
    if elem.get("tmt"):
        t = elem["tmt"]
        if kb.generico(t).id != generico:
            raise ErrorModelo(f"elemento {elem['id']}: tmt {t!r} no es un {generico}")
        return t
    nombre = str(elem["nombre"]).lower()
    codigo = str(elem["codigo"]).lower().split("#", 1)[0]
    if elem["tipo"] == "actor":
        if re.search(r"navegador|browser", nombre):
            return "SE.EI.TMCore.Browser"
        if re.search(r"\bentra\b|oauth|oidc|identidad|\bidp\b", nombre):
            return "SE.EI.TMCore.AuthProvider"
        if re.search(r"extensi|wallet|freighter", nombre):
            return "SE.EI.TMCore.WebApp"
        if re.search(r"\bapi\b|horizon|stellar|telegram|anthropic|github|friendbot|servicio|webhook|cron", nombre):
            return "SE.EI.TMCore.WebSvc"
        return "SE.EI.TMCore.User"
    if elem["tipo"] == "proceso":
        if re.search(r"\.mjs$|\.sh$|scripts/", codigo) or re.search(r"worker|script", nombre):
            return "SE.P.TMCore.OSProcess"
        if re.search(r"route\.ts$|middleware\.ts$", codigo):
            return "SE.P.TMCore.WebSvc"
        return "SE.P.TMCore.WebApp"
    # almacén
    if re.search(r"cookie|localstorage|sessionstorage|almacenamiento local", nombre):
        return "SE.DS.TMCore.HTML5LS"
    if re.search(r"stellar|ledger|horizon|blob|nube|\blogs?\b|stdout|salida est", nombre):
        return "SE.DS.TMCore.CloudStorage"
    if re.search(r"memoria|cach", nombre):
        return "SE.DS.TMCore.Cache"
    if re.search(r"archivo|disco|\.md\b|\.json\b", nombre):
        return "SE.DS.TMCore.ConfigFile"
    return "SE.DS.TMCore.SQL"


def tipo_flujo(flujo: dict) -> str:
    p = str(flujo["protocolo"]).upper()
    if "HTTPS" in p or re.search(r"STELLAR|TELEGRAM|ANTHROPIC|ENTRA|OAUTH|OIDC|GITHUB|TLS", p):
        return "SE.DF.TMCore.HTTPS"
    if re.search(r"\bHTTP\b", p):
        return "SE.DF.TMCore.HTTP"
    return "SE.DF.TMCore.Binary"


# ---------------------------------------------------------------------------
# Distribución en columnas y bandas
# ---------------------------------------------------------------------------
def columnas(modelo: dict) -> dict[str, int]:
    orden = [e["id"] for e in modelo["elementos"]]
    vecinos: dict[str, list[str]] = {i: [] for i in orden}
    for f in modelo["flujos"]:
        vecinos[f["de"]].append(f["a"])
        vecinos[f["a"]].append(f["de"])
    col: dict[str, int] = {}
    for inicio in orden:
        if inicio in col:
            continue
        col[inicio] = 0
        cola = deque([inicio])
        while cola:
            v = cola.popleft()
            for w in vecinos[v]:
                if w not in col:
                    col[w] = col[v] + 1
                    cola.append(w)
    return col


def _rectangulo(pos: dict, ids: list[str]) -> tuple[int, int, int, int]:
    xs = [pos[c][0] for c in ids]
    ys = [pos[c][1] for c in ids]
    x0, y0 = min(xs) - RELLENO, min(ys) - RELLENO_SUP
    x1, y1 = max(xs) + ANCHO + RELLENO, max(ys) + ALTO + RELLENO
    return (x0, y0, x1 - x0, y1 - y0)


def distribuir(modelo: dict) -> tuple[dict[str, tuple[int, int]], list[tuple[int, int, int, int]]]:
    """
    Posición (x, y) de cada elemento y rectángulo (x, y, ancho, alto) de cada frontera.

    1. Columna = saltos desde el primer elemento del JSON (lectura de izquierda a derecha).
    2. Los elementos de cada frontera van en su propia banda horizontal, así los
       rectángulos de las fronteras no se montan.
    3. Los elementos que no están en ninguna frontera (casi siempre actores externos)
       se colocan uno a uno junto a sus vecinos ya colocados: lo más cerca posible de
       su columna y de la altura media de sus vecinos, fuera de toda frontera y sin
       pisar otro elemento.
    """
    col = columnas(modelo)
    banda_de: dict[str, int] = {}
    for n, fr in enumerate(modelo["fronteras"]):
        for c in fr["contiene"]:
            banda_de.setdefault(c, n)
    pos: dict[str, tuple[int, int]] = {}
    if not banda_de:
        # Sin fronteras: una sola banda.
        filas: dict[int, int] = {}
        for e in modelo["elementos"]:
            c = col[e["id"]]
            filas[c] = filas.get(c, 0) + 1
            pos[e["id"]] = (MARGEN_X + c * PASO_X, MARGEN_Y + (filas[c] - 1) * PASO_Y)
        return pos, []
    orden_bandas: list[int] = []
    for e in modelo["elementos"]:
        b = banda_de.get(e["id"])
        if b is not None and b not in orden_bandas:
            orden_bandas.append(b)
    y_banda = MARGEN_Y
    for b in orden_bandas:
        filas = {}
        for e in modelo["elementos"]:
            if banda_de.get(e["id"]) != b:
                continue
            c = col[e["id"]]
            fila = filas.get(c, 0)
            filas[c] = fila + 1
            pos[e["id"]] = (MARGEN_X + c * PASO_X, y_banda + fila * PASO_Y)
        y_banda += max(filas.values()) * PASO_Y + HUECO_BANDA
    rects = [_rectangulo(pos, fr["contiene"]) for fr in modelo["fronteras"]]

    vecinos: dict[str, list[str]] = {e["id"]: [] for e in modelo["elementos"]}
    for f in modelo["flujos"]:
        vecinos[f["de"]].append(f["a"])
        vecinos[f["a"]].append(f["de"])
    max_col = max(col.values())

    def libre(x: int, y: int) -> bool:
        for rx, ry, rw, rh in rects:
            if x < rx + rw + 30 and x + ANCHO + 30 > rx and y < ry + rh + 30 and y + ALTO + 30 > ry:
                return False
        return all(abs(x - px) >= ANCHO + 60 or abs(y - py) >= ALTO + 50 for px, py in pos.values())

    pendientes = [e["id"] for e in modelo["elementos"] if e["id"] not in pos]
    while pendientes:
        listos = [i for i in pendientes if any(v in pos for v in vecinos[i])] or pendientes[:1]
        ident = listos[0]
        pendientes.remove(ident)
        colocados = [pos[v] for v in vecinos[ident] if v in pos]
        y_ideal = round(sum(p[1] for p in colocados) / len(colocados)) if colocados else MARGEN_Y
        c_ideal = col[ident]
        mejor = None
        for c in range(-3, max_col + 4):
            for k in range(0, 41):
                for signo in ((1,) if k == 0 else (1, -1)):
                    y = y_ideal + signo * k * (PASO_Y // 2)
                    if y < MARGEN_Y:
                        continue
                    costo = abs(c - c_ideal) * PASO_X + abs(y - y_ideal)
                    if mejor is not None and costo >= mejor[0]:
                        continue
                    x = MARGEN_X + c * PASO_X
                    if libre(x, y):
                        mejor = (costo, x, y)
        if mejor is None:  # no debería pasar: siempre hay sitio a la derecha
            mejor = (0, MARGEN_X + (max_col + 4) * PASO_X, MARGEN_Y + len(pos) * PASO_Y)
        pos[ident] = (mejor[1], mejor[2])
    # Si algo quedó a la izquierda del margen, se corre todo el dibujo.
    corrimiento = MARGEN_X - min(x for x, _ in pos.values())
    if corrimiento > 0:
        pos = {i: (x + corrimiento, y) for i, (x, y) in pos.items()}
        rects = [(x + corrimiento, y, w, h) for x, y, w, h in rects]
    return pos, rects


def geometria_flujo(origen: tuple[int, int], destino: tuple[int, int], carril: int):
    if destino[0] > origen[0]:
        po, pd = "East", "West"
    elif destino[0] < origen[0]:
        po, pd = "West", "East"
    elif destino[1] > origen[1]:
        po, pd = "South", "North"
    else:
        po, pd = "North", "South"
    ox, oy = origen[0] + PUERTOS[po][0], origen[1] + PUERTOS[po][1]
    dx, dy = destino[0] + PUERTOS[pd][0], destino[1] + PUERTOS[pd][1]
    # Asa de la curva: punto medio desplazado en perpendicular. Los flujos de ida y
    # vuelta entre el mismo par quedan a lados opuestos; los repetidos se separan.
    vx, vy = dx - ox, dy - oy
    largo = max((vx * vx + vy * vy) ** 0.5, 1.0)
    desplazamiento = 28 + 32 * carril
    hx = round((ox + dx) / 2 - vy / largo * desplazamiento)
    hy = round((oy + dy) / 2 + vx / largo * desplazamiento)
    return po, pd, (ox, oy), (dx, dy), (hx, hy)


# ---------------------------------------------------------------------------
# Generación
# ---------------------------------------------------------------------------
def guid(feature: str, ident: str) -> str:
    return str(uuid.uuid5(ESPACIO_GUID, f"{feature}:{ident}"))


def svg_dfd(modelo: dict, pos: dict, rects: list, trazos: list) -> str:
    """Imagen del mismo diagrama (misma geometría que el .tm7), para la ficha y la revisión sin Windows."""
    ancho = max([x + ANCHO for x, _ in pos.values()] + [x + w for x, _, w, _ in rects]) + MARGEN_X
    alto = max([y + ALTO for _, y in pos.values()] + [y + h for _, y, _, h in rects]) + MARGEN_Y
    p = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ancho} {alto}" width="{ancho}" height="{alto}" '
        'font-family="Segoe UI, Arial, sans-serif" font-size="13">',
        f"<title>{esc(modelo['titulo'])}</title>",
        '<defs><marker id="punta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        '<path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker></defs>',
        f'<rect width="{ancho}" height="{alto}" fill="#ffffff"/>',
    ]
    for fr, (x, y, w, h) in zip(modelo["fronteras"], rects):
        p.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="#c0392b" stroke-width="1.5" stroke-dasharray="8 5"/>')
        p.append(f'<text x="{x + 8}" y="{y + 18}" fill="#c0392b">{esc(fr["nombre"])}</text>')
    for f, (ox, oy), (dx, dy), (hx, hy) in trazos:
        # Bézier cuadrática que pasa por el asa a mitad de camino.
        cx, cy = 2 * hx - (ox + dx) / 2, 2 * hy - (oy + dy) / 2
        color = "#b03a2e" if f["sensible"] else "#555"
        p.append(
            f'<path d="M{ox},{oy} Q{cx:.0f},{cy:.0f} {dx},{dy}" fill="none" stroke="{color}" stroke-width="1.3" marker-end="url(#punta)"/>'
        )
        etiqueta = f"{f['id']} {f['nombre']}" + (" *" if f["sensible"] else "")
        p.append(f'<text x="{hx}" y="{hy}" text-anchor="middle" font-size="11" fill="{color}">{esc(etiqueta)}</text>')
    for e in modelo["elementos"]:
        x, y = pos[e["id"]]
        cx, cy = x + ANCHO // 2, y + ALTO // 2
        if e["tipo"] == "actor":
            p.append(f'<rect x="{x}" y="{y}" width="{ANCHO}" height="{ALTO}" fill="#fdfefe" stroke="#222" stroke-width="1.5"/>')
        elif e["tipo"] == "proceso":
            p.append(f'<circle cx="{cx}" cy="{cy}" r="{ANCHO // 2}" fill="#fdfefe" stroke="#222" stroke-width="1.5"/>')
        else:
            p.append(f'<rect x="{x}" y="{y + 20}" width="{ANCHO}" height="{ALTO - 40}" fill="#fdfefe" stroke="none"/>')
            p.append(f'<line x1="{x}" y1="{y + 20}" x2="{x + ANCHO}" y2="{y + 20}" stroke="#222" stroke-width="1.5"/>')
            p.append(f'<line x1="{x}" y1="{y + ALTO - 20}" x2="{x + ANCHO}" y2="{y + ALTO - 20}" stroke="#222" stroke-width="1.5"/>')
        palabras, lineas_txt, actual = e["nombre"].split(), [], ""
        for w in palabras:
            if actual and len(actual) + 1 + len(w) > 14:
                lineas_txt.append(actual)
                actual = w
            else:
                actual = f"{actual} {w}".strip()
        lineas_txt.append(actual)
        y0 = cy - (len(lineas_txt) - 1) * 8 + 4
        for k, linea in enumerate(lineas_txt[:4]):
            p.append(f'<text x="{cx}" y="{y0 + k * 16}" text-anchor="middle" fill="#222">{esc(linea)}</text>')
    p.append(
        f'<text x="{MARGEN_X}" y="{alto - 20}" font-size="11" fill="#777">{esc(modelo["titulo"])} · '
        f'docs/dfd/{esc(modelo["feature"])}.json · commit {esc(modelo["commit"])} · * = flujo con datos sensibles</text>'
    )
    p.append("</svg>")
    return "\n".join(p) + "\n"


_RESERVADAS_MERMAID = {"end", "graph", "subgraph", "flowchart", "style", "class", "classdef", "click", "default", "direction", "linkstyle"}


def mermaid(modelo: dict) -> str:
    """
    Bloque Mermaid (flowchart LR) para la sección 2 de la ficha, con la convención
    acordada: actores [/ /], procesos (( )), almacenes [( )], fronteras como
    subgraph. Los flujos sensibles llevan * y van en rojo.
    """
    def ident(i: str) -> str:
        s = re.sub(r"\W", "_", str(i))
        return s + "_" if s.lower() in _RESERVADAS_MERMAID or s[:1].isdigit() else s

    def texto(t: str) -> str:
        return str(t).replace('"', "'").replace("<", "‹").replace(">", "›").replace("\n", " ")

    forma = {"actor": ('[/"', '"/]'), "proceso": ('(("', '"))'), "almacen": ('[("', '")]')}
    nodo = {e["id"]: f'{ident(e["id"])}{forma[e["tipo"]][0]}{texto(e["nombre"])}{forma[e["tipo"]][1]}' for e in modelo["elementos"]}
    lineas = ["flowchart LR"]
    dibujados: set[str] = set()
    for n, fr in enumerate(modelo["fronteras"], 1):
        lineas.append(f'  subgraph F{n}["{texto(fr["nombre"])}"]')
        for c in fr["contiene"]:
            if c not in dibujados:
                lineas.append(f"    {nodo[c]}")
                dibujados.add(c)
        lineas.append("  end")
    for e in modelo["elementos"]:
        if e["id"] not in dibujados:
            lineas.append(f"  {nodo[e['id']]}")
    rojos = []
    for k, f in enumerate(modelo["flujos"]):
        marca = " *" if f["sensible"] else ""
        lineas.append(f'  {ident(f["de"])} -->|"{texto(f["id"] + " " + f["nombre"] + marca)}"| {ident(f["a"])}')
        if f["sensible"]:
            rojos.append(str(k))
    if rojos:
        lineas.append(f"  linkStyle {','.join(rojos)} stroke:#b03a2e,color:#b03a2e")
    for n in range(1, len(modelo["fronteras"]) + 1):
        lineas.append(f"  style F{n} fill:none,stroke:#c0392b,stroke-dasharray:6 4")
    return "```mermaid\n" + "\n".join(lineas) + "\n```\n"


def generar(modelo: dict, plantilla: Plantilla) -> tuple[str, dict[str, str], str]:
    kb = plantilla.kb
    feature = modelo["feature"]
    pos, rects = distribuir(modelo)
    guids = {e["id"]: guid(feature, e["id"]) for e in modelo["elementos"]}
    zid = 2
    bordes = []
    for e in modelo["elementos"]:
        t = tipo_tmt(e, kb)
        ge = kb.generico(t).id
        x, y = pos[e["id"]]
        bordes.append(
            xml_borde(zid, CLASE_POR_GENERICO[ge], ge, guids[e["id"]], kb.propiedades(t, e["nombre"]), t, x, y, ANCHO, ALTO, 0)
        )
        zid += 1
    for n, (fr, (x, y, w, h)) in enumerate(zip(modelo["fronteras"], rects)):
        t = fr.get("tmt", "SE.TB.B.TMCore.CorpNet")
        if kb.generico(t).id != "GE.TB.B":
            raise ErrorModelo(f"frontera {fr['nombre']!r}: tmt {t!r} no es un GE.TB.B")
        g = guid(feature, f"frontera:{n}:{fr['nombre']}")
        bordes.append(xml_borde(zid, "BorderBoundary", "GE.TB.B", g, kb.propiedades(t, fr["nombre"]), t, x, y, w, h, 1))
        zid += 1
    lineas = []
    trazos = []
    carriles: dict[tuple[str, str], int] = {}
    for f in modelo["flujos"]:
        t = tipo_flujo(f)
        par = (f["de"], f["a"])
        carril = carriles.get(par, 0)
        carriles[par] = carril + 1
        po, pd, (ox, oy), (dx, dy), (hx, hy) = geometria_flujo(pos[f["de"]], pos[f["a"]], carril)
        trazos.append((f, (ox, oy), (dx, dy), (hx, hy)))
        lineas.append(
            xml_linea(
                zid, "Connector", "GE.DF", guid(feature, f"flujo:{f['id']}"), kb.propiedades(t, f["nombre"]), t,
                hx, hy, po, pd, guids[f["de"]], ox, oy, guids[f["a"]], dx, dy,
            )
        )
        zid += 1
    superficie = xml_superficie(guid(feature, "superficie"), modelo["titulo"], "".join(bordes), "".join(lineas))
    sensibles = [f"{f['id']} {f['nombre']}: {f['datos']}" for f in modelo["flujos"] if f["sensible"]]
    externos = [e["nombre"] for e in modelo["elementos"] if e["tipo"] == "actor"]
    meta = xml_meta(
        modelo["titulo"],
        f"Generado por docs/dfd/generar_tm7.py desde docs/dfd/{feature}.json (commit de referencia {modelo['commit']}). "
        "Ficha: docs/features/" + feature + ".md",
        ("Flujos con datos sensibles: " + " | ".join(sensibles)) if sensibles else "",
        ", ".join(externos),
    )
    return plantilla.componer(superficie, meta, zid), guids, svg_dfd(modelo, pos, rects, trazos)


# ---------------------------------------------------------------------------
# Validación del .tm7 generado
# ---------------------------------------------------------------------------
def prefijos_declarados(texto: str) -> list[str]:
    """Todo prefijo usado en un nombre o en un valor i:type debe estar declarado en su ámbito."""
    errores: list[str] = []
    pila: list[set[str]] = [{"xml"}]
    p = xml.parsers.expat.ParserCreate()  # sin procesar espacios de nombres: se ven los prefijos tal cual

    def inicio(nombre, attrs):
        decl = set(pila[-1])
        for k in attrs:
            if k.startswith("xmlns:"):
                decl.add(k[6:])
        pila.append(decl)
        usados = [nombre] + [k for k in attrs if not k.startswith("xmlns")]
        for u in usados:
            if ":" in u and u.split(":", 1)[0] not in decl:
                errores.append(f"prefijo sin declarar en <{nombre}>: {u}")
        for k, v in attrs.items():
            if k.endswith(":type") and ":" in v and v.split(":", 1)[0] not in decl:
                errores.append(f"prefijo sin declarar en el valor {k}={v!r} de <{nombre}>")

    def fin(_nombre):
        pila.pop()

    p.StartElementHandler = inicio
    p.EndElementHandler = fin
    p.Parse(texto.encode("utf-8"), True)
    return errores[:10]


def validar(texto: str, modelo: dict, plantilla: Plantilla, guids: dict[str, str]) -> list[str]:
    """Devuelve la lista de comprobaciones superadas; lanza ErrorModelo en la primera que falla."""
    ok: list[str] = []

    def falla(msg: str):
        raise ErrorModelo("validación del .tm7: " + msg)

    try:
        raiz = ET.fromstring(texto)
    except ET.ParseError as e:
        falla(f"el XML no parsea: {e}")
    ok.append("XML bien formado")
    errores = prefijos_declarados(texto)
    if errores:
        falla("; ".join(errores))
    ok.append("prefijos de i:type declarados")
    sup = raiz[0][0]
    xi = f"{{{NS_XSI}}}type"
    clases: dict[str, int] = {}
    claves_bordes: set[str] = set()
    nombres: dict[str, str] = {}
    for kv in hijo(sup, "Borders"):
        v = hijo(kv, "Value")
        clase = v.get(xi)
        clases[clase] = clases.get(clase, 0) + 1
        clave = texto_de(kv, "Key")
        if clave != texto_de(v, "Guid"):
            falla(f"Key y Guid distintos en {clave}")
        if clase != "BorderBoundary":
            claves_bordes.add(clave)
        for a in hijo(v, "Properties"):
            if texto_de(a, "DisplayName") == "Name":
                nombres[clave] = texto_de(a, "Value")
    conectores = 0
    for kv in hijo(sup, "Lines"):
        v = hijo(kv, "Value")
        if v.get(xi) != "Connector":
            continue
        conectores += 1
        for extremo in ("SourceGuid", "TargetGuid"):
            if texto_de(v, extremo) not in claves_bordes:
                falla(f"el flujo {texto_de(v, 'Guid')} apunta a {extremo}={texto_de(v, extremo)} inexistente")
    ok.append("cada flujo apunta a elementos existentes")
    esperado = {
        "StencilRectangle": sum(e["tipo"] == "actor" for e in modelo["elementos"]),
        "StencilEllipse": sum(e["tipo"] == "proceso" for e in modelo["elementos"]),
        "StencilParallelLines": sum(e["tipo"] == "almacen" for e in modelo["elementos"]),
        "BorderBoundary": len(modelo["fronteras"]),
    }
    for clase, n in esperado.items():
        if clases.get(clase, 0) != n:
            falla(f"{clase}: hay {clases.get(clase, 0)}, el JSON pide {n}")
    if conectores != len(modelo["flujos"]):
        falla(f"Connector: hay {conectores}, el JSON pide {len(modelo['flujos'])}")
    ok.append(
        "conteos = JSON (actores {StencilRectangle}, procesos {StencilEllipse}, almacenes {StencilParallelLines}, "
        "fronteras {BorderBoundary}, flujos {c})".format(c=conectores, **esperado)
    )
    for e in modelo["elementos"]:
        if nombres.get(guids[e["id"]]) != esc(e["nombre"]).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"):
            falla(f"el nombre de {e['id']} no se conservó")
    ok.append("nombres conservados")
    zids = re.findall(r'z:Id="i(\d+)"', texto)
    if sorted(map(int, zids)) != list(range(1, len(zids) + 1)):
        falla("z:Id repetidos o con huecos")
    if re.search(r"z:Ref=", texto):
        falla("hay z:Ref y este generador no los produce")
    ok.append(f"z:Id únicos y consecutivos (i1..i{len(zids)})")
    ti = hijo(raiz, "ThreatInstances")
    if ti is None or len(ti):
        falla("ThreatInstances debería estar vacío")
    ok.append("sin amenazas (ThreatInstances vacío)")
    kb_salida = texto[slice(*recortar(texto, "<KnowledgeBase", "</KnowledgeBase>"))]
    if re.sub(r'z:Id="i\d+"', "", kb_salida, count=1) != re.sub(r'z:Id="i\d+"', "", plantilla.kb_texto, count=1):
        falla("la base de conocimiento cambió respecto de la plantilla")
    ok.append("base de conocimiento idéntica a la plantilla")
    return ok


# ---------------------------------------------------------------------------
# Herramientas de mantenimiento
# ---------------------------------------------------------------------------
def leer_superficie(raiz: ET.Element) -> ET.Element:
    lista = hijo(raiz, "DrawingSurfaceList")
    if lista is None or not len(lista):
        raise ErrorModelo("el .tm7 no tiene DrawingSurfaceModel")
    if len(lista) > 1:
        print("  aviso: el .tm7 tiene varios diagramas; se usa el primero", file=sys.stderr)
    return lista[0]


def verificar_contra(ruta: Path) -> int:
    """Re-serializa el diagrama de un .tm7 de la herramienta y lo compara byte a byte."""
    plantilla = Plantilla(ruta)
    kb = plantilla.kb
    t = plantilla.texto
    s0, s1 = recortar(t, "<DrawingSurfaceList>", "</DrawingSurfaceList>")
    original = t[s0:s1]
    sup = leer_superficie(plantilla.raiz)
    xi = f"{{{NS_XSI}}}type"
    z = f"{{{NS_SER}}}Id"

    def leer_props(v):
        nombre, indices, orden, fuera, razon = "", {}, "0", "false", ""
        for a in hijo(v, "Properties"):
            visible, clave, valor = texto_de(a, "DisplayName"), texto_de(a, "Name"), hijo(a, "Value")
            if visible == "Name":
                nombre = valor.text or ""
            elif clave == ID_ORDEN_FLUJO:
                orden = valor.text or ""
            elif clave == ID_FUERA_DE_ALCANCE:
                fuera = valor.text or "false"
            elif clave == ID_RAZON_FUERA:
                razon = valor.text or ""
            elif a.get(xi, "").endswith(":ListDisplayAttribute"):
                indices[clave] = int(texto_de(a, "SelectedIndex", "0"))
        return nombre, indices, orden, fuera, razon

    def nombre_crudo(v_guid: str) -> str | None:
        # Los nombres pueden traer saltos de línea con \r que ElementTree normaliza:
        # se toma el texto tal cual del original.
        i = original.find(f"<Guid {ABS}>{v_guid}</Guid>")
        m = re.search(r"<b:DisplayName>Name</b:DisplayName><b:Name/><b:Value i:type=\"c:string\" [^>]*>(.*?)</b:Value>", original[i:], re.S)
        return m.group(1) if m else None

    MARCA = "\ue000"  # marcador del nombre; se sustituye por el texto crudo del original
    bordes, lineas = [], []
    for kv in hijo(sup, "Borders"):
        v = hijo(kv, "Value")
        g = texto_de(v, "Guid")
        nombre, indices, orden, fuera, razon = leer_props(v)
        props = kb.propiedades(texto_de(v, "TypeId"), MARCA, indices, orden, fuera, razon)
        crudo = nombre_crudo(g)
        props = props.replace(MARCA, crudo if crudo is not None else esc(nombre))
        bordes.append(
            xml_borde(
                v.get(z)[1:], v.get(xi), texto_de(v, "GenericTypeId"), g, props, texto_de(v, "TypeId"),
                texto_de(v, "Left"), texto_de(v, "Top"), texto_de(v, "Width"), texto_de(v, "Height"),
                texto_de(v, "StrokeThickness"),
            )
        )
    for kv in hijo(sup, "Lines"):
        v = hijo(kv, "Value")
        g = texto_de(v, "Guid")
        nombre, indices, orden, fuera, razon = leer_props(v)
        props = kb.propiedades(texto_de(v, "TypeId"), MARCA, indices, orden, fuera, razon)
        crudo = nombre_crudo(g)
        props = props.replace(MARCA, crudo if crudo is not None else esc(nombre))
        lineas.append(
            xml_linea(
                v.get(z)[1:], v.get(xi), texto_de(v, "GenericTypeId"), g, props, texto_de(v, "TypeId"),
                texto_de(v, "HandleX"), texto_de(v, "HandleY"), texto_de(v, "PortSource"), texto_de(v, "PortTarget"),
                texto_de(v, "SourceGuid"), texto_de(v, "SourceX"), texto_de(v, "SourceY"),
                texto_de(v, "TargetGuid"), texto_de(v, "TargetX"), texto_de(v, "TargetY"),
            )
        )
    titulo = texto_de(sup, "Header")
    regenerado = xml_superficie(texto_de(sup, "Guid"), titulo, "".join(bordes), "".join(lineas))
    print(f"verificar-contra {ruta.name}: {len(bordes)} estenciles, {len(lineas)} líneas")
    if regenerado == original:
        print(f"  OK: el diagrama re-serializado es idéntico byte a byte ({len(original)} caracteres)")
        return 0
    i = next((k for k, (a, b) in enumerate(zip(regenerado, original)) if a != b), min(len(regenerado), len(original)))
    print(f"  DIFERENTE en el carácter {i} (regenerado {len(regenerado)} / original {len(original)})")
    print(f"  original:    ...{original[max(0, i - 160):i + 160]}...")
    print(f"  regenerado:  ...{regenerado[max(0, i - 160):i + 160]}...")
    return 1


def limpiar_plantilla(origen: Path, destino: Path) -> int:
    """Copia de un .tm7 sin diagrama, sin amenazas y sin datos del modelo; la KB va intacta."""
    p = Plantilla(origen)
    superficie = xml_superficie(guid("plantilla", "superficie"), "Plantilla", "", "")
    texto = p.componer(superficie, xml_meta("", "", "", ""), 2)
    raiz = ET.fromstring(texto)
    if len(hijo(raiz, "ThreatInstances")) or len(hijo(leer_superficie(raiz), "Borders")):
        raise ErrorModelo("la plantilla limpia todavía trae amenazas o estenciles")
    destino.write_text(texto, encoding="utf-8", newline="")
    print(f"plantilla escrita en {destino} ({len(texto.encode('utf-8'))} bytes, KB {len(p.kb_texto)} caracteres)")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def procesar(ruta_json: Path, plantilla: Plantilla, salida: Path | None, estricto: bool, con_svg: bool = True) -> bool:
    print(f"== {ruta_json.name}")
    try:
        modelo = cargar_modelo(ruta_json)
        avisos = avisos_de_modelo(modelo, ruta_json)
        for a in avisos:
            print(f"  aviso: {a}")
        codigo = [a for a in avisos if a.startswith("código:")]
        if estricto and codigo:
            raise ErrorModelo(f"{len(codigo)} aviso(s) de ubicación en el código con --estricto")
        texto, guids, svg = generar(modelo, plantilla)
        comprobaciones = validar(texto, modelo, plantilla, guids)
        ET.fromstring(svg)
    except (ErrorModelo, ET.ParseError) as e:
        print(f"  ERROR: {e}")
        return False
    destino = (salida or ruta_json.parent) / (ruta_json.stem + ".tm7")
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(texto, encoding="utf-8", newline="")
    for c in comprobaciones:
        print(f"  ok: {c}")
    print(f"  escrito {destino} ({len(texto.encode('utf-8'))} bytes)")
    if con_svg:
        imagen = destino.with_suffix(".svg")
        imagen.write_text(svg, encoding="utf-8", newline="\n")
        print(f"  escrito {imagen} (imagen del diagrama)")
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Genera .tm7 (Microsoft Threat Modeling Tool 4.3) desde docs/dfd/<feature>.json")
    ap.add_argument("json", nargs="*", type=Path, help="fuentes JSON de los DFD")
    ap.add_argument("--todos", action="store_true", help="procesa todos los docs/dfd/*.json")
    ap.add_argument("--plantilla", type=Path, default=PLANTILLA_POR_DEFECTO, help="plantilla .tm7 (por defecto docs/dfd/plantilla.tm7)")
    ap.add_argument("--salida", type=Path, help="carpeta de salida (por defecto, junto a cada JSON)")
    ap.add_argument("--estricto", action="store_true", help="los avisos de ubicación en el código cuentan como error")
    ap.add_argument("--sin-svg", action="store_true", help="no escribe la imagen <feature>.svg")
    ap.add_argument("--mermaid", action="store_true", help="solo imprime el bloque Mermaid de cada JSON (no escribe archivos)")
    ap.add_argument("--verificar-contra", type=Path, metavar="TM7", help="autoprueba del serializador contra un .tm7 de la herramienta")
    ap.add_argument("--limpiar-plantilla", nargs=2, type=Path, metavar=("ORIGEN", "DESTINO"), help="crea una plantilla limpia")
    args = ap.parse_args(argv)
    for flujo in (sys.stdout, sys.stderr):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    try:
        if args.verificar_contra:
            return verificar_contra(args.verificar_contra)
        if args.limpiar_plantilla:
            return limpiar_plantilla(*args.limpiar_plantilla)
        fuentes = list(args.json)
        if args.todos:
            fuentes += sorted(p for p in AQUI.glob("*.json") if p not in fuentes)
        if not fuentes:
            ap.error("indica uno o más JSON, o --todos")
        if args.mermaid:
            for p in fuentes:
                print(f"<!-- {p.name} -->")
                print(mermaid(cargar_modelo(p)))
            return 0
        if not args.plantilla.is_file():
            raise ErrorModelo(
                f"no encuentro la plantilla {args.plantilla}. Pásala con --plantilla RUTA "
                "(cualquier .tm7 guardado con Threat Modeling Tool 4.3 sirve)."
            )
        plantilla = Plantilla(args.plantilla)
    except ErrorModelo as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    resultados = [procesar(p, plantilla, args.salida, args.estricto, not args.sin_svg) for p in fuentes]
    fallos = resultados.count(False)
    print(f"\n{len(resultados) - fallos} generado(s), {fallos} con error")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
