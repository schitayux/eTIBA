import frappe

from erpnext.stock.utils import _update_item_info
from erpnext.stock.utils import scan_barcode as scan_barcode_erpnext


@frappe.whitelist()
def scan_barcode(search_value: str):
	"""El escaneo de ERPNext, mas un fallback al codigo de producto.

	ERPNext solo busca en Item Barcode, Serial No y Batch. Las etiquetas de eTIBA
	cuyo formato tiene identificador_tipo "Codigo" (ACCESORIOS, MUNICIONES) llevan
	el item_code en el QR, asi que sin este fallback el escaneo solo funciona con
	articulos serializados.
	"""
	resultado = scan_barcode_erpnext(search_value)
	if resultado:
		return resultado

	item = frappe.db.get_value("Item", search_value, ["name as item_code", "disabled"], as_dict=True)
	if not item or item.disabled:
		return {}

	item.pop("disabled", None)
	return _update_item_info(item)
