import frappe

from erpnext.stock.utils import _update_item_info
from erpnext.stock.utils import scan_barcode as scan_barcode_erpnext

# Un lector configurado con teclado US sobre un equipo en español emite "'" donde
# el codigo lleva "-" (en la distribucion latinoamericana el guion cae sobre la
# tecla del apostrofe): "OAC-347" llega como "OAC'347". Ningun Item, Serial No,
# Batch ni Item Barcode contiene apostrofes, asi que revertir el cambio no puede
# tapar un codigo real. Es una red de seguridad: lo correcto es configurarle la
# distribucion al lector.
SUSTITUCIONES_TECLADO = {"'": "-"}


def _buscar(valor):
	"""Busqueda de ERPNext (Item Barcode, Serial No, Batch) mas el codigo de producto."""
	resultado = scan_barcode_erpnext(valor)
	if resultado:
		return resultado

	item = frappe.db.get_value("Item", valor, ["name as item_code", "disabled"], as_dict=True)
	if not item or item.disabled:
		return {}

	item.pop("disabled", None)
	return _update_item_info(item)


@frappe.whitelist()
def scan_barcode(search_value: str):
	"""El escaneo de ERPNext, mas el codigo de producto y el arreglo de teclado.

	ERPNext solo busca en Item Barcode, Serial No y Batch. Las etiquetas de eTIBA
	cuyo formato tiene identificador_tipo "Codigo" (ACCESORIOS, MUNICIONES) llevan
	el item_code en el QR, asi que sin el fallback el escaneo solo funciona con
	articulos serializados o con los que tienen una fila en Item Barcode.
	"""
	resultado = _buscar(search_value)
	if resultado:
		return resultado

	alterno = search_value
	for origen, destino in SUSTITUCIONES_TECLADO.items():
		alterno = alterno.replace(origen, destino)

	if alterno != search_value:
		return _buscar(alterno)

	return {}
