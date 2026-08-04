import type {
  InfoRequestFieldDef,
  InfoRequestPresetKey,
} from "./api";

function field(
  partial: Omit<InfoRequestFieldDef, "id"> & { id?: string },
): InfoRequestFieldDef {
  return {
    id: partial.id ?? partial.key,
    ...partial,
  };
}

/** Starter field packs — admin can still edit freely after selecting a preset. */
export function buildInfoRequestPresetFields(
  preset: InfoRequestPresetKey,
): InfoRequestFieldDef[] {
  switch (preset) {
    case "smart_credit":
      return [
        field({
          key: "smart_credit",
          type: "smart_credit_block",
          label_en: "Smart Credit access",
          label_es: "Acceso a Smart Credit",
          required: true,
          help_en:
            "We use these credentials only to pull your three-bureau report and track progress.",
          help_es:
            "Usamos estas credenciales solo para obtener tu reporte de tres burós y dar seguimiento.",
        }),
      ];
    case "payment_card":
      return [
        field({
          key: "payment_card",
          type: "payment_card",
          label_en: "Update card on file",
          label_es: "Actualizar tarjeta registrada",
          required: true,
          help_en:
            "Enter a new card securely. Card numbers never touch our servers.",
          help_es:
            "Ingresa una nueva tarjeta de forma segura. Los números nunca llegan a nuestros servidores.",
        }),
      ];
    case "payment_billing":
      return [
        field({
          key: "billing_confirm",
          type: "billing_confirm",
          label_en: "Confirm billing details",
          label_es: "Confirmar datos de facturación",
          required: true,
        }),
      ];
    case "custom":
    default:
      return [
        field({
          key: "notes",
          type: "textarea",
          label_en: "Your response",
          label_es: "Tu respuesta",
          required: true,
        }),
        field({
          key: "attachment",
          type: "upload",
          label_en: "Attachment (optional)",
          label_es: "Adjunto (opcional)",
          required: false,
        }),
      ];
  }
}

export function defaultInfoRequestTitles(preset: InfoRequestPresetKey): {
  title_en: string;
  title_es: string;
  message_en: string;
  message_es: string;
} {
  switch (preset) {
    case "smart_credit":
      return {
        title_en: "Smart Credit access needed",
        title_es: "Se necesita acceso a Smart Credit",
        message_en:
          "Please provide your Smart Credit login so we can continue monitoring your credit repair progress.",
        message_es:
          "Por favor proporciona tu acceso a Smart Credit para que podamos seguir monitoreando tu progreso.",
      };
    case "payment_card":
      return {
        title_en: "Update payment card",
        title_es: "Actualizar tarjeta de pago",
        message_en:
          "We need an updated card on file to continue your service without interruption.",
        message_es:
          "Necesitamos una tarjeta actualizada registrada para continuar tu servicio sin interrupciones.",
      };
    case "payment_billing":
      return {
        title_en: "Confirm billing information",
        title_es: "Confirmar información de facturación",
        message_en:
          "Please confirm your billing address and the last 4 digits of the card on file.",
        message_es:
          "Por favor confirma tu dirección de facturación y los últimos 4 dígitos de la tarjeta registrada.",
      };
    case "custom":
    default:
      return {
        title_en: "Information requested",
        title_es: "Información solicitada",
        message_en:
          "Our team needs a bit more information from you. Please complete the items below.",
        message_es:
          "Nuestro equipo necesita un poco más de información. Por favor completa los puntos a continuación.",
      };
  }
}

export const INFO_REQUEST_SENSITIVE_FIELD_TYPES = new Set([
  "password",
  "smart_credit_block",
]);

export function isSensitiveFieldType(type: string): boolean {
  return INFO_REQUEST_SENSITIVE_FIELD_TYPES.has(type);
}
