frappe.listview_settings["Serial No"] = frappe.listview_settings["Serial No"] || {};

(function () {
	const original_onload = frappe.listview_settings["Serial No"].onload;

	frappe.listview_settings["Serial No"].onload = function (listview) {
		if (original_onload) {
			original_onload(listview);
		}

		listview.page.add_inner_button(
			__("Imprimir con Formato"),
			function () {
				etiba.imprimir_etiquetas_lote(listview);
			},
			__("Herramientas")
		);
	};
})();

frappe.provide("etiba");

etiba.imprimir_etiquetas_lote = async function (listview) {
	const selected_items = listview.get_checked_items();

	if (!selected_items.length) {
		frappe.msgprint(__("No se ha seleccionado ningun registro."));
		return;
	}

	const cantidad_defecto = await frappe.db.get_single_value("Etiba Settings", "cantidad_por_defecto");

	const d = new frappe.ui.Dialog({
		title: __("Detalles de Impresion"),
		fields: [
			{
				label: __("Formato"),
				fieldname: "formato",
				fieldtype: "Link",
				options: "Etiba Formato",
				reqd: 1,
				get_query: () => ({ filters: { activo: 1 } }),
			},
			{
				label: __("Cantidad a imprimir"),
				fieldname: "cantidad",
				fieldtype: "Int",
				default: cantidad_defecto || 1,
				reqd: 1,
			},
		],
		primary_action_label: __("Imprimir"),
		primary_action: function (values) {
			if (values.cantidad < 1) {
				frappe.msgprint(__("La cantidad debe ser al menos 1."));
				return;
			}
			d.hide();
			etiba.procesar_lote(selected_items, values.formato, values.cantidad);
		},
	});

	d.show();
};

etiba.procesar_lote = async function (selected_items, formato, cantidad) {
	const series = [...new Set(selected_items.map((item) => item.name))];
	const productos = [...new Set(selected_items.map((item) => item.item_code))];

	const print_service_url = await frappe.db.get_single_value("Etiba Settings", "print_service_url");
	if (!print_service_url) {
		frappe.msgprint(__("Configura la URL del servicio de impresion en Etiba Settings."));
		return;
	}

	frappe.show_alert({ message: __("Procesando etiquetas. Esto puede tomar unos momentos..."), indicator: "blue" });

	const pares = [];
	for (let i = 0; i < series.length; i++) {
		pares.push({ serie: series[i], producto: productos[i % productos.length] });
	}

	const chunk_size = 2;
	const total_chunks = Math.ceil((pares.length * cantidad) / chunk_size);
	let completados = 0;

	for (let i = 0; i < pares.length; i += chunk_size) {
		const chunk = pares.slice(i, i + chunk_size);

		try {
			const r = await frappe.call({
				method: "etiba.api.imprimir_etiquetas.obtener_valores_multiple",
				args: {
					series: JSON.stringify(chunk.map((item) => item.serie)),
					productos: JSON.stringify(chunk.map((item) => item.producto)),
					formato: formato,
					cantidad: cantidad,
				},
			});

			if (!r || !r.message || !r.message.zpl) {
				frappe.msgprint(__("No se pudo generar el ZPL para el lote."));
				continue;
			}

			const response = await fetch(print_service_url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ zplcode: r.message.zpl }),
			});

			if (response.ok) {
				completados++;
				if (completados === total_chunks) {
					frappe.msgprint(__("Todas las etiquetas han sido enviadas a impresion."));
				}
			} else {
				frappe.msgprint(__("Error al imprimir. Verifique la impresora."));
			}
		} catch (error) {
			frappe.msgprint(__("Error al conectar con el servicio de impresion: {0}", [error.message]));
		}
	}
};
