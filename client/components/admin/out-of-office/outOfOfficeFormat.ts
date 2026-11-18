/** "Wednesday 11/25" / "miércoles 25 de noviembre" — same wording as the client texts. */
export function formatReturnDay(ymd: string, es = false): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return es
    ? d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    : `${d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** The client text preview while someone is away (mirrors the server wording). */
export function outOfOfficePreview(o: { lang: "en" | "es"; awayName: string; returnsLabel: string; backupName: string }): string {
  return o.lang === "es"
    ? `¡Hola María! Recibimos tu mensaje sobre tu reporte de progreso. ${o.awayName} está fuera de la oficina hasta el ${o.returnsLabel}; ${o.backupName} (español) te responderá hoy. - Optimum Financial Group`
    : `Hi Maria! We got your message about your progress report. ${o.awayName} is out of the office until ${o.returnsLabel}; ${o.backupName} (English) will reply today. - Optimum Financial Group`;
}
