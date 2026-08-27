import type { ConversationMergeContext } from "@/lib/conversationTemplateVars";
import { applyConversationTemplateVars } from "@/lib/conversationTemplateVars";

export type ConversationSuggestion = {
  id: string;
  label: string;
  body: string;
  source: "static" | "ai";
};

type SuggestionContext = {
  kind: "client" | "unknown";
  mergeContext: ConversationMergeContext;
  pipelineStage?: string | null;
  clientStatus?: string | null;
  preferredLanguage?: string | null;
};

/** Pipeline-aware quick replies (EN + ES). Bodies support {{first_name}} etc. */
export function buildStaticConversationSuggestions(
  ctx: SuggestionContext,
): ConversationSuggestion[] {
  const es = ctx.preferredLanguage === "es";
  const stage = ctx.pipelineStage || (ctx.kind === "unknown" ? "unknown" : "");
  const status = ctx.clientStatus || "";

  const defs: Array<{ id: string; label: string; body: string }> = [];

  if (ctx.kind === "unknown" || status === "unknown") {
    defs.push(
      es
        ? {
            id: "unk-intro-es",
            label: "Presentación OFG",
            body: "Hola, gracias por escribir a Optimum Credit / OFG. ¿Me comparte su nombre para ayudarle con su crédito?",
          }
        : {
            id: "unk-intro-en",
            label: "OFG intro",
            body: "Hi! Thanks for reaching out to Optimum Credit (OFG). May I have your name so we can help with your credit?",
          },
      es
        ? {
            id: "unk-docs-es",
            label: "Pedir documentos",
            body: "Para empezar necesitamos ID, tarjeta del SSN y comprobante de domicilio. ¿Puede enviarlos por aquí o prefiere nuestro portal?",
          }
        : {
            id: "unk-docs-en",
            label: "Ask for docs",
            body: "To get started we’ll need your ID, SSN card, and proof of address. Can you send photos here or would you prefer our upload portal?",
          },
      es
        ? {
            id: "unk-call-es",
            label: "Agendar llamada",
            body: "¿Le funciona una llamada rápida hoy para explicarle el proceso y los siguientes pasos?",
          }
        : {
            id: "unk-call-en",
            label: "Schedule call",
            body: "Would a quick call today work to walk you through the process and next steps?",
          },
    );
  } else if (status === "prospect" || stage === "prospect") {
    defs.push(
      es
        ? {
            id: "pro-follow-es",
            label: "Seguimiento prospecto",
            body: "Hola {{first_name}}, le escribo de OFG para dar seguimiento. ¿Tiene preguntas sobre cómo empezar?",
          }
        : {
            id: "pro-follow-en",
            label: "Prospect follow-up",
            body: "Hi {{first_name}}, following up from OFG — do you have any questions about getting started?",
          },
      es
        ? {
            id: "pro-portal-es",
            label: "Link portal",
            body: "Hola {{first_name}}, puede subir documentos aquí: {{portal_url}}",
          }
        : {
            id: "pro-portal-en",
            label: "Portal link",
            body: "Hi {{first_name}}, you can upload documents here: {{portal_url}}",
          },
    );
  } else if (stage === "new_client") {
    defs.push(
      es
        ? {
            id: "nc-docs-es",
            label: "Recordatorio docs",
            body: "Hola {{first_name}}, ¿pudo subir su ID y comprobante de domicilio? {{portal_url}}",
          }
        : {
            id: "nc-docs-en",
            label: "Docs reminder",
            body: "Hi {{first_name}}, were you able to upload your ID and proof of address? {{portal_url}}",
          },
    );
  } else if (stage?.startsWith("round_") || stage === "docs_ready") {
    defs.push(
      es
        ? {
            id: "active-check-es",
            label: "Check-in",
            body: "Hola {{first_name}}, solo verificando cómo va su proceso. ¿Alguna pregunta?",
          }
        : {
            id: "active-check-en",
            label: "Check-in",
            body: "Hi {{first_name}}, just checking in on your credit repair progress. Any questions?",
          },
    );
  }

  defs.push(
    es
      ? {
          id: "thanks-es",
          label: "Gracias",
          body: "Gracias {{first_name}} — recibimos su mensaje y le respondemos pronto.",
        }
      : {
          id: "thanks-en",
          label: "Thanks",
          body: "Thank you {{first_name}} — we got your message and will follow up shortly.",
        },
  );

  return defs.slice(0, 5).map((d) => ({
    id: d.id,
    label: d.label,
    body: applyConversationTemplateVars(d.body, ctx.mergeContext),
    source: "static" as const,
  }));
}
