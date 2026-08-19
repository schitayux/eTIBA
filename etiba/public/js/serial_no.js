frappe.ui.form.on("Serial No", {
	refresh(frm) {
		frm.add_custom_button(
			__("Imprimir Etiqueta"),
			function () {
				etiba.imprimir_etiqueta_serie(frm);
			},
			"fa fa-print"
		).addClass("btn-success");
	},
});

frappe.provide("etiba");

etiba.imprimir_etiqueta_serie = async function (frm) {
	const [sugerido_r, cantidad_defecto] = await Promise.all([
		frappe.call({
			method: "etiba.api.imprimir_etiquetas.obtener_formato_sugerido",
			args: { codigo_producto: frm.doc.item_code },
		}),
		frappe.db.get_single_value("Etiba Settings", "cantidad_por_defecto"),
	]);

	if (!sugerido_r || !sugerido_r.message) {
		frappe.msgprint(__("No se pudo obtener informacion del producto {0}.", [frm.doc.item_code]));
		return;
	}

	const sugerido = sugerido_r.message;

	frappe.prompt(
		[
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
				label: __("Cantidad a imprimir"),
				fieldname: "cantidad",
				fieldtype: "Int",
				default: cantidad_defecto || 1,
				reqd: 1,
			},
		],
		function (values) {
			etiba.enviar_a_imprimir(frm, values.formato, values.cantidad);
		},
		__("Imprimir Etiqueta")
	);
};

etiba.enviar_a_imprimir = function (frm, formato, cantidad) {
	frappe.call({
		method: "etiba.api.imprimir_etiquetas.obtener_valores",
		args: {
			identificador: frm.doc.name,
			formato: formato,
			codigo_producto: frm.doc.item_code,
			cantidad: cantidad,
		},
		callback: function (response) {
			if (!response || !response.message) {
				frappe.msgprint(__("No se pudo generar el codigo ZPL para {0}.", [frm.doc.name]));
				return;
			}
			etiba.enviar_al_servicio_impresion(response.message, frm.doc.name);
		},
	});
};

etiba.enviar_al_servicio_impresion = function (zplcode, referencia) {
	frappe.db.get_single_value("Etiba Settings", "print_service_url").then((url) => {
		if (!url) {
			frappe.msgprint(__("Configura la URL del servicio de impresion en Etiba Settings."));
			return;
		}

		fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ zplcode: zplcode }),
		})
			.then((response) => {
				if (response.ok) {
					frappe.show_alert({ message: __("Imprimiendo etiqueta..."), indicator: "green" });
				} else {
					frappe.msgprint(__("Error al imprimir la etiqueta de {0}.", [referencia]));
				}
			})
			.catch(() => {
				frappe.msgprint(__("No se pudo conectar con el servicio de impresion ({0}).", [url]));
			});
	});
};
