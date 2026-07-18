import { createFileRoute } from "@tanstack/react-router";
import { Camera, CheckCircle2, FileText, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createWorker } from "tesseract.js";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "세무 도우미 - 종이 계산서 촬영" }, { name: "description", content: "종이 세금계산서 촬영 및 전자세금계산서 입력 보조" }] }),
  component: InvoiceAssistant,
});

type InvoiceFields = { recipientNumber: string; recipientName: string; itemName: string; supplyAmount: string; issueDate: string };
const today = () => new Date().toISOString().slice(0, 10);
const emptyFields = (): InvoiceFields => ({ recipientNumber: "", recipientName: "", itemName: "", supplyAmount: "", issueDate: today() });

function parseInvoiceText(text: string) {
  const source = text.replace(/\s+/g, " ");
  const number = source.match(/\b\d{3}[- ]?\d{2}[- ]?\d{5}\b/)?.[0]?.replace(/ /g, "") ?? "";
  const dateMatch = source.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  const issueDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}` : "";
  const amount = source.match(/(?:공급가액|합계금액|금액)\s*[:：]?\s*([\d,]+)/)?.[1]?.replace(/,/g, "") ?? "";
  return { recipientNumber: number, issueDate, supplyAmount: amount };
}

function InvoiceAssistant() {
  const [fields, setFields] = useState<InvoiceFields>(emptyFields);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photo, setPhoto] = useState("");
  const [rawText, setRawText] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [message, setMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const update = (key: keyof InvoiceFields, value: string) => setFields((previous) => ({ ...previous, [key]: value }));
  const stopCamera = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  useEffect(() => () => stopCamera(), []);

  const openCamera = () => { setCameraOpen(true); setPhoto(""); setRawText(""); setMessage(""); };
  const startCamera = async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { setMessage("카메라를 사용할 수 없어요. 아래에서 사진 파일을 골라 주세요."); }
  };
  const usePhoto = (dataUrl: string) => { setPhoto(dataUrl); stopCamera(); };
  const takePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return setMessage("카메라가 준비될 때까지 잠시 기다려 주세요.");
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    usePhoto(canvas.toDataURL("image/jpeg", 0.9));
  };
  const chooseFile = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => usePhoto(String(reader.result)); reader.readAsDataURL(file); };
  const readReceipt = async () => {
    if (!photo) return setMessage("먼저 사진을 찍거나 사진 파일을 골라 주세요.");
    setIsReading(true); setMessage("");
    try {
      const worker = await createWorker("kor+eng");
      const { data } = await worker.recognize(photo);
      await worker.terminate();
      setRawText(data.text);
      setFields((previous) => ({ ...previous, ...parseInvoiceText(data.text) }));
      setMessage("사진에서 읽은 값을 입력란에 반영했어요. 빈칸과 숫자를 꼭 확인해 주세요.");
    } catch { setMessage("글자를 읽지 못했어요. 사진을 다시 찍거나 직접 입력해 주세요."); }
    finally { setIsReading(false); }
  };
  const closeCamera = () => { stopCamera(); setCameraOpen(false); };
  const issue = () => setMessage("모의 발급이 완료되었습니다. 실제 홈택스에는 전송되지 않았어요.");

  return <div className="min-h-screen bg-slate-100 text-slate-800">
    <header className="bg-[#07539a] text-white shadow-sm"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><div><p className="text-2xl font-extrabold">세무 도우미</p><p className="text-sm text-blue-100">종이 세금계산서를 사진으로 간편하게</p></div><p className="hidden text-sm sm:block">도움이 필요하신가요? ☎ 1588-0000</p></div></header>
    <main className="mx-auto max-w-6xl px-4 py-7">
      <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><p className="mb-1 text-sm font-bold text-[#07539a]">첫 번째, 종이 계산서를 준비해 주세요</p><h1 className="text-2xl font-extrabold">사진을 찍으면 내용을 채워 드릴게요</h1><p className="mt-2 text-slate-600">읽은 결과는 꼭 확인하고 고칠 수 있어요.</p></div><button onClick={openCamera} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0874d1] px-6 py-4 text-lg font-bold text-white hover:bg-[#07539a]"><Camera size={25} /> 계산서 촬영하기</button></div></section>
      <div className="mb-5 flex items-center gap-3 text-sm font-bold"><span className="rounded-full bg-[#07539a] px-3 py-1 text-white">1 사진 촬영</span><span className="text-slate-400">→</span><span>2 내용 확인</span><span className="text-slate-400">→</span><span>3 발급</span></div>
      <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm"><div className="mb-5 flex items-center gap-2 border-b border-slate-200 pb-4"><FileText className="text-[#07539a]" /><h2 className="text-xl font-bold">전자세금계산서 내용 확인</h2><span className="ml-auto text-sm text-red-600">* 필수 입력</span></div>
        <div className="grid gap-5 lg:grid-cols-2"><PartyCard title="공급자 (나)" tone="blue"><ReadOnly label="사업자등록번호" value="123-45-67890" /><ReadOnly label="상호" value="내 가게" /><ReadOnly label="대표자 성명" value="홍길동" /></PartyCard><PartyCard title="공급받는 분 (거래처)" tone="orange"><Field label="사업자등록번호" value={fields.recipientNumber} placeholder="예: 123-45-67890" onChange={(value) => update("recipientNumber", value)} /><Field label="상호" value={fields.recipientName} placeholder="사진을 보고 적어 주세요" onChange={(value) => update("recipientName", value)} /><Field label="품목" value={fields.itemName} placeholder="예: 농산물 판매" onChange={(value) => update("itemName", value)} /></PartyCard></div>
        <div className="mt-5 grid gap-4 rounded-xl bg-slate-50 p-4 md:grid-cols-2"><Field label="작성일" type="date" value={fields.issueDate} onChange={(value) => update("issueDate", value)} /><Field label="공급가액 (부가세 제외)" inputMode="numeric" value={fields.supplyAmount} placeholder="예: 100000" onChange={(value) => update("supplyAmount", value.replace(/[^0-9]/g, ""))} /></div>
        <div className="mt-6 flex flex-col items-center gap-3 border-t border-slate-200 pt-5"><p className="text-sm text-slate-600">사진 OCR은 보조 기능입니다. 발급 전 모든 정보를 확인해 주세요.</p><button onClick={issue} className="rounded-lg bg-[#07539a] px-10 py-3 text-lg font-bold text-white hover:bg-[#053f77]">모의 홈택스에서 발급하기</button></div>
      </section>
      {message && <div role="status" className="fixed bottom-6 left-1/2 z-30 max-w-[90%] -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-4 text-center text-white shadow-xl">{message}</div>}
    </main>
    {cameraOpen && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4"><section role="dialog" aria-modal="true" aria-label="종이 세금계산서 촬영" className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-2xl font-extrabold">종이 계산서 촬영</h2><p className="mt-1 text-slate-600">글자와 금액이 선명하게 보이게 찍어 주세요.</p></div><button aria-label="닫기" onClick={closeCamera} className="rounded-lg p-2 hover:bg-slate-100"><X /></button></div><div className="flex min-h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-900">{photo ? <img src={photo} alt="촬영한 세금계산서" className="max-h-96 object-contain" /> : <video ref={videoRef} autoPlay muted playsInline className="max-h-96 w-full object-contain" />}</div><div className="mt-4 flex flex-wrap gap-2"><button onClick={startCamera} className="rounded-lg border border-slate-300 px-4 py-3 font-bold">카메라 켜기</button><button onClick={takePhoto} className="rounded-lg bg-[#07539a] px-4 py-3 font-bold text-white">사진 찍기</button><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-3 font-bold"><Upload size={18} /> 사진 파일 고르기<input className="hidden" type="file" accept="image/*" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0])} /></label>{photo && <button onClick={() => { setPhoto(""); setRawText(""); }} className="rounded-lg border border-slate-300 px-4 py-3">다시 찍기</button>}</div><div className="mt-5 rounded-xl bg-blue-50 p-4"><button disabled={isReading} onClick={readReceipt} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0874d1] px-4 py-4 text-lg font-bold text-white disabled:opacity-60">{isReading ? <><LoaderCircle className="animate-spin" /> 글자를 읽는 중…</> : <><CheckCircle2 /> 사진 내용 읽어서 입력하기</>}</button><p className="mt-2 text-center text-sm text-slate-600">사진은 이 브라우저에서만 처리되며 저장하지 않아요.</p></div>{rawText && <details className="mt-4 rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-bold">읽은 전체 글자 보기</summary><pre className="mt-2 whitespace-pre-wrap font-sans">{rawText}</pre></details>}</section></div>}
  </div>;
}

function PartyCard({ title, tone, children }: { title: string; tone: "blue" | "orange"; children: ReactNode }) { return <div className={`rounded-xl border ${tone === "blue" ? "border-blue-200" : "border-orange-200"}`}><h3 className={`rounded-t-xl px-4 py-3 text-lg font-bold ${tone === "blue" ? "bg-blue-50 text-blue-900" : "bg-orange-50 text-orange-900"}`}>{title}</h3><div className="space-y-3 p-4">{children}</div></div>; }
function Field({ label, value, onChange, placeholder, type = "text", inputMode }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; inputMode?: "numeric" }) { return <label className="block text-sm font-bold text-slate-700">{label}<input type={type} inputMode={inputMode} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-3 text-base font-normal outline-none focus:border-[#0874d1] focus:ring-2 focus:ring-blue-100" /></label>; }
function ReadOnly({ label, value }: { label: string; value: string }) { return <div><p className="text-sm font-bold text-slate-700">{label}</p><p className="mt-1.5 rounded-lg bg-slate-100 px-3 py-3">{value}</p></div>; }
