import re

import frappe
from frappe import _


def _limpiar_zpl(zpl):
	return "".join(ch for ch in zpl if 32 <= ord(ch) <= 126 or ch in "\n\r").replace("\r\n", "\n")


def _formato_por_grupo(item_group):
	if not item_group:
		return None

	filas = frappe.get_all("Etiba Formato Grupo", filters={"item_group": item_group}, fields=["parent"])
	for fila in filas:
		if frappe.db.get_value("Etiba Formato", fila.parent, "activo"):
			return fila.parent
	return None


def _formato_activo_o_none(formato):
	if formato and frappe.db.get_value("Etiba Formato", formato, "activo"):
		return formato
	return None


@frappe.whitelist()
def obtener_formato_sugerido(codigo_producto):
	"""Devuelve el formato activo sugerido para un item, y si requiere numero de serie."""
	item = frappe.db.get_value("Item", codigo_producto, ["item_group", "item_name"], as_dict=True)
	if not item:
		frappe.throw(_("No se encontro el producto {0}").format(codigo_producto))

	formato = _formato_por_grupo(item.item_group)
	if not formato:
		formato = _formato_activo_o_none(frappe.db.get_single_value("Etiba Settings", "formato_por_defecto"))

	requiere_serie = False
	if formato:
		requiere_serie = frappe.db.get_value("Etiba Formato", formato, "identificador_tipo") == "Serie"

	return {
		"item_group": item.item_group,
		"item_name": item.item_name,
		"formato_sugerido": formato,
		"requiere_serie": requiere_serie,
	}


def _resolver_variable2(codigo_producto, formato_doc):
	campos = [c.strip() for c in (formato_doc.variable2_campos or "").split(",") if c.strip()]
	if not campos:
		return ""

	item_meta = frappe.get_meta("Item")
	campos_validos = [c for c in campos if item_meta.has_field(c) or c in ("item_code", "item_name", "item_group")]
	if not campos_validos:
		return ""

	item = frappe.db.get_value("Item", codigo_producto, campos_validos, as_dict=True)
	if not item:
		return ""

	valores = [str(item.get(c)) for c in campos_validos if item.get(c)]
	return (formato_doc.variable2_separador or "/").join(valores)


def _dividir_descripcion(texto, ancho=22):
	"""Parte una descripcion larga en 2 lineas de max 'ancho' caracteres, cortando en un espacio si se puede."""
	texto = (texto or "").strip()
	if len(texto) <= ancho:
		return texto, ""

	corte = texto.rfind(" ", 0, ancho + 1)
	if corte <= 0:
		corte = ancho
	linea1 = texto[:corte].strip()
	resto = texto[corte:].strip()
	if len(resto) > ancho:
		resto = resto[: ancho - 3].strip() + "..."
	return linea1, resto


def _aplicar_cantidad(codigo, lenguaje, cantidad):
	"""Pide 'cantidad' copias a la impresora en vez de repetir la etiqueta N veces.

	El servicio de impresion local solo procesa el primer bloque cuando le llegan
	varias etiquetas concatenadas, asi que la repeticion la hace el equipo:
	^PQ en ZPL, el segundo argumento de PRINT en TSPL.
	"""
	if cantidad <= 1:
		return codigo

	if lenguaje == "TSPL":
		nuevo, n = re.subn(
			r"(?im)^([ \t]*PRINT[ \t]+\d+)[ \t]*(?:,[ \t]*\d+)?[ \t]*$",
			r"\g<1>," + str(cantidad),
			codigo,
		)
		return nuevo if n else codigo

	if re.search(r"\^PQ\d", codigo, re.IGNORECASE):
		return re.sub(r"(?i)\^PQ\d+(?:,\d+)*", "^PQ{0}".format(cantidad), codigo, count=1)

	ultimo = None
	for ultimo in re.finditer(r"\^XZ", codigo, re.IGNORECASE):
		pass
	if ultimo is None:
		return codigo

	return codigo[: ultimo.start()] + "^PQ{0}\n".format(cantidad) + codigo[ultimo.start() :]


def _plantilla_de(formato_doc):
	plantilla = formato_doc.codigo_tspl if formato_doc.lenguaje == "TSPL" else formato_doc.codigo_zpl
	if not plantilla:
		frappe.throw(
			_("El formato {0} no tiene codigo {1} configurado.").format(formato_doc.name, formato_doc.lenguaje)
		)
	return plantilla


@frappe.whitelist()
def obtener_valores(identificador, formato, codigo_producto, cantidad=1):
	"""Genera 'cantidad' copias de una etiqueta para un identificador (serie o codigo) + producto."""
	formato_doc = frappe.get_cached_doc("Etiba Formato", formato)
	if not formato_doc.activo:
		frappe.throw(_("El formato {0} esta inactivo.").format(formato))

	plantilla = _plantilla_de(formato_doc)
	item_name = frappe.db.get_value("Item", codigo_producto, "item_name") or ""
	variable2 = _resolver_variable2(codigo_producto, formato_doc)
	desc_l1, desc_l2 = _dividir_descripcion(item_name)

	cantidad = int(cantidad or 1)
	zpl = plantilla.strip()
	zpl = zpl.replace("$$VARIABLE1$$", str(identificador))
	zpl = zpl.replace("$$VARIABLE2$$", str(variable2))
	zpl = zpl.replace("$$VARIABLE3_L2$$", desc_l2)
	zpl = zpl.replace("$$VARIABLE3$$", desc_l1)

	return _limpiar_zpl(_aplicar_cantidad(zpl, formato_doc.lenguaje, cantidad))


@frappe.whitelist()
def obtener_valores_multiple(series, productos, formato=None, cantidad=1):
	"""Genera el ZPL para un lote de series/productos (impresion desde la lista), 2 etiquetas por tarjeta."""
	if formato and not _formato_activo_o_none(formato):
		frappe.throw(_("El formato {0} esta inactivo.").format(formato))

	series = frappe.parse_json(series)
	productos = frappe.parse_json(productos)
	cantidad = int(cantidad or 1)

	if not series or not productos:
		frappe.throw(_("Series y productos son obligatorios."))

	pares = []
	for serie, producto in zip(series, productos):
		pares.extend([(serie, producto)] * cantidad)

	config_base = "^XA\n^LH0,0\n^CFA,20\n^LT0\n^PR5,5,5\n^LL260"
	zpl_result = ""

	for i in range(0, len(pares), 2):
		bloque = pares[i : i + 2]
		serie1, producto1 = bloque[0]

		if len(bloque) == 2:
			serie2, producto2 = bloque[1]
			linea2 = (
				f"\n^FO25,187^FD{serie2}^FS"
				f"\n^FO25,207^FD{producto2}^FS"
				f"\n^FO320,165^BQ,2,4^FDLA,{serie2}^FS"
			)
		else:
			linea2 = "\n^FO25,187^FD ^FS\n^FO25,207^FD ^FS\n^FO320,165^FD ^FS"

		zpl_result += (
			f"{config_base}\n"
			f"^FO25,57^FD{serie1}^FS\n"
			f"^FO25,77^FD{producto1}^FS\n"
			f"^FO320,42^BQ,2,4^FDLA,{serie1}^FS"
			f"{linea2}\n^XZ\n"
		)

	return {"zpl": _limpiar_zpl(zpl_result), "series_y_productos": pares}
