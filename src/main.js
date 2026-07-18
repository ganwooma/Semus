const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { runInvoiceFlow } = require('./playwright-flow');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TARGET_URL = process.env.TAX_TARGET_URL || 'https://estamp-helper.lovable.app/';
const APP_ICON = path.join(__dirname, '..', 'icon.ico');
const GEMINI_PROMPT = `Read this Korean tax invoice image. Return exactly one valid JSON object matching the template below. Do not include reasoning, explanations, analysis, Markdown, code fences, or any text before or after the JSON. Extract up to four line items and every field below. Use null when a value is unknown.
{
  "issueDate": "",
  "supplier": { "companyName": "", "businessNumber": "", "representativeName": "", "postalCode": "", "businessAddress": "", "businessType": "", "businessCategory": "" },
  "customer": { "companyName": "", "businessNumber": "", "representativeName": "", "postalCode": "", "businessAddress": "", "businessType": "", "businessCategory": "" },
  "items": [{ "month": "", "day": "", "name": "", "specification": "", "quantity": "", "price": "", "supplyAmount": "", "tax": "", "remark": "" }],
  "supplyAmount": "", "tax": "", "totalAmount": "",
  "cashAmount": "", "checkAmount": "", "noteAmount": "", "accountsReceivable": "",
  "claimType": "청구 or 영수"
}`;
const textField = { type: 'STRING', nullable: true };
const partySchema = { type: 'OBJECT', properties: { companyName: textField, businessNumber: textField, representativeName: textField, postalCode: textField, businessAddress: textField, businessType: textField, businessCategory: textField } };
const itemSchema = { type: 'OBJECT', properties: { month: textField, day: textField, name: textField, specification: textField, quantity: textField, price: textField, supplyAmount: textField, tax: textField, remark: textField } };
const GEMINI_SCHEMA = { type: 'OBJECT', properties: { issueDate: textField, supplier: partySchema, customer: partySchema, items: { type: 'ARRAY', maxItems: 4, items: itemSchema }, supplyAmount: textField, tax: textField, totalAmount: textField, cashAmount: textField, checkAmount: textField, noteAmount: textField, accountsReceivable: textField, claimType: textField } };
let cvPromise;

async function getOpenCV() {
  if (!cvPromise) {
    const candidate = require('@techstark/opencv-js'); const module = candidate.default || candidate;
    cvPromise = module instanceof Promise ? module : module.Mat ? Promise.resolve(module) : new Promise((resolve) => { module.onRuntimeInitialized = () => resolve(module); });
  }
  return cvPromise;
}
function orderCorners(points) { const ordered = [...points].sort((a, b) => (a.x + a.y) - (b.x + b.y)); const middle = [ordered[1], ordered[2]].sort((a, b) => (a.y - a.x) - (b.y - b.x)); return [ordered[0], middle[0], ordered[3], middle[1]]; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/** OpenCV detects the largest 4-corner document contour and corrects perspective. */
async function preprocessDocument(imageDataUrl) {
  const sharp = require('sharp'); const cv = await getOpenCV();
  const input = Buffer.from(imageDataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, ''), 'base64');
  const decoded = await sharp(input, { limitInputPixels: 36_000_000 }).rotate().resize({ width: 2400, height: 3400, fit: 'inside', withoutEnlargement: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = cv.matFromImageData({ data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), width: decoded.info.width, height: decoded.info.height });
  const gray = new cv.Mat(); const blurred = new cv.Mat(); const edges = new cv.Mat(); const contours = new cv.MatVector(); const hierarchy = new cv.Mat(); let output = source;
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0); cv.Canny(blurred, edges, 60, 180); cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    let best; let bestArea = 0;
    for (let index = 0; index < contours.size(); index += 1) { const contour = contours.get(index); const polygon = new cv.Mat(); cv.approxPolyDP(contour, polygon, 0.02 * cv.arcLength(contour, true), true); const area = cv.contourArea(polygon); if (polygon.rows === 4 && area > bestArea && area > source.rows * source.cols * 0.15) { best?.delete(); best = polygon; bestArea = area; } else polygon.delete(); contour.delete(); }
    if (best) { const value = best.data32S; const corners = orderCorners([{ x: value[0], y: value[1] }, { x: value[2], y: value[3] }, { x: value[4], y: value[5] }, { x: value[6], y: value[7] }]); const width = Math.round(Math.max(distance(corners[0], corners[1]), distance(corners[2], corners[3]))); const height = Math.round(Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]))); if (width > 300 && height > 300) { const from = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap((point) => [point.x, point.y])); const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]); const transform = cv.getPerspectiveTransform(from, to); output = new cv.Mat(); cv.warpPerspective(source, output, transform, new cv.Size(width, height)); from.delete(); to.delete(); transform.delete(); } best.delete(); }
    const result = new cv.Mat(); cv.cvtColor(output, result, cv.COLOR_RGBA2GRAY); cv.equalizeHist(result, result); cv.adaptiveThreshold(result, result, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 9); const png = await sharp(Buffer.from(result.data), { raw: { width: result.cols, height: result.rows, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer(); result.delete(); return png;
  } finally { if (output !== source) output.delete(); source.delete(); gray.delete(); blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete(); }
}
function value(input) { return typeof input === 'string' || typeof input === 'number' ? String(input).trim() : ''; }
function normalizeIssueDate(input) { const text = value(input); const match = text.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/); return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : ''; }
function fieldsFromExtraction(data) {
  const extractedItems = Array.isArray(data.items) ? data.items.slice(0, 4) : [];
  const items = Array.from({ length: 4 }, (_, index) => {
    const item = extractedItems[index] || {};
    const quantity = value(item.quantity); const unitPrice = value(item.price);
    return {
      month: value(item.month), day: value(item.day), name: value(item.name), specification: value(item.specification), quantity, unitPrice,
      amount: value(item.supplyAmount) || (index === 0 ? value(data.supplyAmount) || value(data.totalAmount) : ''),
      tax: value(item.tax) || (index === 0 ? value(data.tax) : ''), remark: value(item.remark)
    };
  });
  return {
    supplierBusinessNumber: value(data.supplier?.businessNumber), supplierName: value(data.supplier?.companyName), supplierRepresentative: value(data.supplier?.representativeName), supplierPostalCode: value(data.supplier?.postalCode), supplierAddress: value(data.supplier?.businessAddress), supplierBusinessType: value(data.supplier?.businessType), supplierBusinessCategory: value(data.supplier?.businessCategory),
    recipientBusinessNumber: value(data.customer?.businessNumber), recipientName: value(data.customer?.companyName), recipientRepresentative: value(data.customer?.representativeName), recipientPostalCode: value(data.customer?.postalCode), recipientAddress: value(data.customer?.businessAddress), recipientBusinessType: value(data.customer?.businessType), recipientBusinessCategory: value(data.customer?.businessCategory),
    cashAmount: value(data.cashAmount), checkAmount: value(data.checkAmount), noteAmount: value(data.noteAmount), accountsReceivable: value(data.accountsReceivable), claimType: value(data.claimType) === '영수' ? '영수' : '청구', items,
    issueDate: normalizeIssueDate(data.issueDate) || new Date().toISOString().slice(0, 10)
  };
}
function parseGeminiJson(text) {
  const cleaned = String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* Fall through: some models prepend an explanation despite JSON mode. */ }
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('Gemini가 JSON 객체를 반환하지 않았어요.');
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') { depth -= 1; if (depth === 0) return JSON.parse(cleaned.slice(start, index + 1)); }
  }
  throw new Error('Gemini 응답에서 완전한 JSON을 찾지 못했어요.');
}
async function recognizeWithGemini(imageDataUrl) {
  const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았어요. .env 파일을 확인해 주세요.');
  const image = await preprocessDocument(imageDataUrl); const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }, { text: GEMINI_PROMPT }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: false } } }), signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('정보를 읽는 데 1분 이상 걸려 중단했어요. 사진을 다시 찍은 뒤 다시 시도해 주세요.');
    throw error;
  }
  const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || `Gemini 요청이 실패했어요. (${response.status})`); const text = body.candidates?.[0]?.content?.parts?.filter((part) => typeof part.text === 'string' && !part.thought).map((part) => part.text).join(''); if (!text) throw new Error('Gemini가 JSON 결과를 반환하지 않았어요.'); return parseGeminiJson(text);
}
async function createWindow() { const window = new BrowserWindow({ width: 1180, height: 820, minWidth: 960, minHeight: 680, icon: APP_ICON, backgroundColor: '#f7fafc', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } }); await window.loadFile(path.join(__dirname, 'renderer', 'index.html')); }
app.whenReady().then(async () => { ipcMain.handle('invoice:issue', async (_, invoice) => { try { return await runInvoiceFlow(TARGET_URL, invoice); } catch (error) { return { ok: false, message: `자동 입력 중 문제가 생겼어요: ${error.message}` }; } }); ipcMain.handle('invoice:recognize', async (_, imageDataUrl) => { if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/') || imageDataUrl.length > 15_000_000) return { ok: false, message: '사진을 다시 촬영해 주세요.' }; try { const extraction = await recognizeWithGemini(imageDataUrl); const fields = fieldsFromExtraction(extraction); return { ok: true, text: JSON.stringify(extraction, null, 2), fields, extraction }; } catch (error) { return { ok: false, message: `세금계산서 정보를 읽지 못했어요. 직접 입력해 주세요. (${error.message})` }; } }); session.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'media')); await createWindow(); app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow()); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
