// Make text safe for a PDF string: strip accents, replace non-ASCII,
// and escape the characters PDF treats specially
const printable = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/[\\()]/g, '\\$&');

const isoDate = (value) => new Date(value).toISOString().slice(0, 10);

export function createCertificatePdf({
  employeeName,
  courseTitle,
  certificateNumber,
  issueDate,
  expiryDate,
}) {
  // ---- Page content: each line is centred horizontally on an A4 landscape page ----
  const lines = [
    { text: 'NEXORA INDUSTRIES', size: 27, y: 510 },
    { text: 'CERTIFICATE OF COMPLETION', size: 18, y: 455 },
    { text: 'This certifies that', size: 12, y: 390 },
    { text: employeeName, size: 24, y: 345 },
    { text: 'has successfully completed', size: 12, y: 295 },
    { text: courseTitle, size: 20, y: 250 },
    {
      text: `Certificate number: ${certificateNumber || 'N/A'}`,
      size: 11,
      y: 165,
    },
    {
      text: `Issued: ${issueDate ? isoDate(issueDate) : 'N/A'}`,
      size: 11,
      y: 140,
    },
    {
      text: `Valid until: ${expiryDate ? isoDate(expiryDate) : 'No expiry'}`,
      size: 11,
      y: 115,
    },
  ];

  const commands = lines
    .map(({ text, size, y }) => {
      const safe = printable(text);
      // Estimate text width (about 0.52 x font size per character) to centre it
      const x = Math.max(50, Math.round((842 - safe.length * size * 0.52) / 2));
      return `BT /F1 ${size} Tf ${x} ${y} Td (${safe}) Tj ET`;
    })
    .join('\n');

  const stream = `${commands}\n`;

  // ---- PDF objects ----
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  // ---- Assemble the file, recording each object's byte offset ----
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  // ---- Cross-reference table and trailer ----
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'ascii');
}