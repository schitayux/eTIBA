frappe.listview_settings["Item"] = frappe.listview_settings["Item"] || {};

(function () {
	const original_onload = frappe.listview_settings["Item"].onload;

	frappe.listview_settings["Item"].onload = function (listview) {
		if (original_onload) {
			original_onload(listview);
		}

		listview.page.add_inner_button(
			__("Imprimir Etiquetas"),
			function () {
				etiba.imprimir_etiquetas_item(listview);
			},
			__("Herramientas")
		);
	};
})();

frappe.provide("etiba");

etiba.imprimir_etiquetas_item = async function (listview) {
	const selected_items = listview.get_checked_items();

	if (!selected_items.length) {
		frappe.msgprint(__("No se ha seleccionado ningun registro."));
		return;
	}

	const nombres = [...new Set(selected_items.map((item) => item.name))];

	const [sugerido_r, cantidad_defecto] = await Promise.all([
		frappe.call({
			method: "etiba.api.imprimir_etiquetas.obtener_formato_sugerido",
			args: { codigo_producto: nombres[0] },
		}),
		frappe.db.get_single_value("Etiba Settings", "cantidad_por_defecto"),
	]);

	const sugerido = (sugerido_r && sugerido_r.message) || {};

	const fields = [
		{
			label: __("Formato"),
			fieldname: "formato",
			fieldtype: "Link",
			options: "Etiba Formato",
			default: sugerido.formato_sugerido,
			reqd: 1,
			get_query: () => ({ filters: { activo: 1 } }),
		},
		{
			label: __("Cantidad a imprimir por producto"),
			fieldname: "cantidad",
			fieldtype: "Int",
			default: cantidad_defecto || 1,
			reqd: 1,
		},
	];

	if (sugerido.requiere_serie) {
		fields.push({
			label: __("Serie"),
			fieldname: "serie",
			fieldtype: "Link",
			options: "Serial No",
			reqd: 1,
			get_query: () => ({
				filters: { item_code: ["in", nombres], status: "Active" },
			}),
		});
	}

	const d = new frappe.ui.Dialog({
		title: __("Detalles de Impresion"),
		fields: fields,
		primary_action_label: __("Imprimir"),
		primary_action: async function (values) {
			d.hide();
			await etiba.imprimir_lote_items(nombres, values.formato, values.cantidad, values.serie);
		},
	});

	d.show();
};

etiba.imprimir_lote_items = async function (nombres, formato, cantidad, serie) {
	const print_service_url = await frappe.db.get_single_value("Etiba Settings", "print_service_url");
	if (!print_service_url) {
		frappe.msgprint(__("Configura la URL del servicio de impresion en Etiba Settings."));
		return;
	}

	frappe.show_alert({ message: __("Procesando etiquetas. Esto puede tomar unos momentos..."), indicator: "blue" });

	let errores = 0;

	for (const codigo_producto of nombres) {
		try {
			const r = await frappe.call({
				method: "etiba.api.imprimir_etiquetas.obtener_valores",
				args: {
					identificador: serie || codigo_producto,
					formato: formato,
					codigo_producto: codigo_producto,
					cantidad: cantidad,
				},
			});

			if (!r || !r.message) {
				errores++;
				continue;
			}

			const response = await fetch(print_service_url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ zplcode: r.message }),
			});

			if (!response.ok) {
				errores++;
			}
		} catch (error) {
			errores++;
		}
	}

	if (errores) {
		frappe.msgprint(__("Se enviaron las etiquetas, pero {0} producto(s) tuvieron error.", [errores]));
	} else {
		frappe.show_alert({ message: __("Todas las etiquetas fueron enviadas a impresion."), indicator: "green" });
	}
};
