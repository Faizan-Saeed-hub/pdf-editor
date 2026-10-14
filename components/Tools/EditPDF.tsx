import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileUpload } from '../UI/FileUpload';
import { PDFFile, ProcessingStatus } from '../../types';
import {
  getPdfFormFields,
  getPageTextEditItems,
  loadPDFDocument,
  type PageTextEditItem,
  type PdfFormFieldDefinition,
  type PdfFormFieldValue,
} from '../../services/pdfBrowser';
import { savePDFWithAnnotations, type EditorElement } from '../../services/pdfDocument';
import { downloadBlob } from '../../services/pdfShared';
import { Save, Trash2, Type, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { Link } from 'react-router-dom';
import { ZoomControls } from '../UI/ZoomControls';
import { useZoom } from '../../hooks/useZoom';
import { StatusToast } from '../UI/StatusToast';

type TextEditItem = PageTextEditItem & { id: string };

type PDFPageProps = {
  pageIndex: number;
  pdfDoc: any;
  elements: EditorElement[];
  formFields: PdfFormFieldDefinition[];
  formValues: Record<string, PdfFormFieldValue>;
  textItems: TextEditItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEditTextItem: (item: TextEditItem, background: string) => void;
  onUpdate: (id: string, updates: Partial<EditorElement>) => void;
  onDelete: (id: string) => void;
  onFormValueChange: (fieldName: string, value: PdfFormFieldValue) => void;
  zoom: number;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => clampByte(value).toString(16).padStart(2, '0')).join('')}`;

// Samples only the pixels just outside the text object. For ordinary PDFs
// (white paper, colored cards, etc.) this gives a seamless replacement patch
// without drawing a visible white rectangle over the document.
const samplePatchBackground = (
  canvas: HTMLCanvasElement,
  item: TextEditItem,
  logicalWidth: number,
  logicalHeight: number,
) => {
  const scaleX = canvas.width / logicalWidth;
  const scaleY = canvas.height / logicalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#ffffff';

  const x = item.left * scaleX;
  const y = item.top * scaleY;
  const w = item.width * scaleX;
  const h = item.height * scaleY;
  const pad = Math.max(3, Math.round(Math.min(w, h) * 0.18));
  const points = [
    [x + w / 2, y - pad],
    [x + w / 2, y + h + pad],
    [x - pad, y + h / 2],
    [x + w + pad, y + h / 2],
    [x + pad, y - pad],
    [x + w - pad, y - pad],
    [x + pad, y + h + pad],
    [x + w - pad, y + h + pad],
  ];

  const samples: [number, number, number][] = [];
  for (const [px, py] of points) {
    const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(px)));
    const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(py)));
    const pixel = ctx.getImageData(sx, sy, 1, 1).data;
    samples.push([pixel[0], pixel[1], pixel[2]]);
  }

  const average = samples.reduce((acc, sample) => [acc[0] + sample[0], acc[1] + sample[1], acc[2] + sample[2]], [0, 0, 0]);
  return rgbToHex(average[0] / samples.length, average[1] / samples.length, average[2] / samples.length);
};

const TextObject = ({
  item,
  replacement,
  selected,
  onClick,
  onChange,
  onDelete,
}: {
  item: TextEditItem;
  replacement?: EditorElement;
  selected: boolean;
  onClick: () => void;
  onChange: (value: string) => void;
  onDelete: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const replacementId = replacement?.id;

  useEffect(() => {
    // Only focus/select when this text object is first activated. The previous
    // dependency on the whole replacement object caused this effect to run
    // after every keystroke because React creates a new object on each update.
    // That reset the selection/caret and made the first typed character appear
    // to be skipped.
    if (selected && replacement && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [selected, replacementId]);

  if (replacement) {
    const fontSize = replacement.fontSize || item.fontSize;
    const width = Math.max(item.width, Math.min(420, Math.max(45, replacement.content.length * fontSize * 0.55)));
    return (
      <div
        className="absolute z-20"
        style={{ left: item.left, top: item.top, width, height: Math.max(item.height + 4, fontSize * 1.25) }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={replacement.content}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onClick}
          className="h-full w-full bg-transparent px-0 py-0 text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          style={{
            fontSize,
            lineHeight: `${Math.max(item.height, fontSize)}px`,
            fontFamily: replacement.fontFamily || item.fontFamily,
            fontWeight: replacement.fontWeight || item.fontWeight,
            fontStyle: replacement.fontStyle || item.fontStyle,
            color: replacement.color || '#000000',
          }}
          aria-label={`Edit ${item.text}`}
        />
        <button
          type="button"
          onClick={onDelete}
          className="absolute -right-7 -top-3 rounded-full bg-red-500 p-1.5 text-white shadow-md"
          title="Restore original text"
        >
          <Trash2 size={12} />
        </button>
        {selected && <div className="pointer-events-none absolute inset-[-3px] rounded-sm border border-blue-500" />}
      </div>
    );
  }

  return (
    <button
      type="button"
      title={`Edit: ${item.text}`}
      className="absolute z-[6] rounded-[2px] border border-transparent bg-transparent p-0 text-left hover:border-blue-400 hover:bg-blue-400/10 focus:border-blue-500 focus:outline-none"
      style={{ left: item.left, top: item.top, width: item.width, height: item.height }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span className="sr-only">Edit {item.text}</span>
    </button>
  );
};

const ResizableElement: React.FC<any> = ({ element, isSelected, onSelect, onUpdate, onDelete, containerRef }) => {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0 });

  const handleStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onSelect();
    const rect = event.currentTarget.getBoundingClientRect();
    start.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      onUpdate(element.id, {
        x: Math.max(0, Math.min(0.98, (event.clientX - rect.left - start.current.x) / rect.width)),
        y: Math.max(0, Math.min(0.98, (event.clientY - rect.top - start.current.y) / rect.height)),
      });
    };
    const end = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [dragging, containerRef, element.id, onUpdate]);

  return (
    <div
      className={`absolute z-10 cursor-move ${isSelected ? 'ring-2 ring-blue-500 z-20' : 'hover:ring-1 ring-blue-300'}`}
      style={{ left: `${element.x * 100}%`, top: `${element.y * 100}%` }}
      onPointerDown={handleStart}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="min-w-[50px] max-w-[280px] rounded px-1 py-0.5 leading-tight"
        style={{ fontSize: element.fontSize || 16, color: element.color || '#000', fontFamily: element.fontFamily, whiteSpace: 'pre-wrap' }}
      >
        {element.content || 'Text'}
      </div>
      {isSelected && (
        <button type="button" onClick={() => onDelete(element.id)} className="absolute -right-3 -top-3 rounded-full bg-red-500 p-1 text-white">
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};

const PDFFormFieldControl: React.FC<{
  field: PdfFormFieldDefinition;
  value: PdfFormFieldValue | undefined;
  onChange: (value: PdfFormFieldValue) => void;
  onActivate: () => void;
}> = ({ field, value, onChange, onActivate }) => {
  const fontSize = Math.max(11, Math.min(16, field.height * 0.55));
  const baseStyle: React.CSSProperties = { position: 'absolute', left: field.x, top: field.y, width: field.width, height: field.height };
  const shared = {
    'data-testid': 'pdf-form-field',
    'data-field-name': field.fieldName,
    'aria-label': field.label,
    disabled: field.readOnly,
    onPointerDown: (event: React.PointerEvent) => { event.stopPropagation(); onActivate(); },
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
  };

  if (field.kind === 'checkbox') return <div style={baseStyle} className="absolute flex items-center justify-center rounded border border-blue-200 bg-white/85"><input {...shared} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-blue-600" /></div>;
  if (field.kind === 'radio') return <label style={baseStyle} className="absolute flex items-center justify-center rounded border border-blue-200 bg-white/85"><input {...shared} type="radio" name={field.fieldName} checked={typeof value === 'string' && value === field.radioValue} onChange={() => onChange(field.radioValue || '')} className="h-4 w-4 accent-blue-600" /></label>;

  if (field.kind === 'select' || field.kind === 'multiselect') {
    const values = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
    return <select {...shared} multiple={field.kind === 'multiselect'} value={field.kind === 'multiselect' ? values : values[0] || ''} onChange={(e) => onChange(field.kind === 'multiselect' ? Array.from(e.currentTarget.selectedOptions).map((o) => o.value) : e.currentTarget.value)} style={{ ...baseStyle, fontSize }} className="absolute rounded border border-blue-200 bg-white/92 px-1 text-slate-900 outline-none focus:border-blue-500">
      {field.kind === 'select' && <option value="">Select...</option>}
      {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  }

  if (field.kind === 'textarea') return <textarea {...shared} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.currentTarget.value)} style={{ ...baseStyle, fontSize, resize: 'none' }} className="absolute rounded border border-blue-200 bg-white/92 px-1 text-slate-900 outline-none focus:border-blue-500" />;
  return <input {...shared} type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.currentTarget.value)} style={{ ...baseStyle, fontSize }} className="absolute rounded border border-blue-200 bg-white/92 px-1 text-slate-900 outline-none focus:border-blue-500" />;
};

const PDFPage: React.FC<PDFPageProps> = ({ pageIndex, pdfDoc, elements, formFields, formValues, textItems, selectedId, onSelect, onEditTextItem, onUpdate, onDelete, onFormValueChange, zoom }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [dims, setDims] = useState({ w: 600, h: 850 });

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { rootMargin: '500px' });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || rendered || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        const renderScale = 2;
        const viewport = page.getViewport({ scale: renderScale });
        setDims({ w: viewport.width / renderScale, h: viewport.height / renderScale });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setRendered(true);
      } catch (error) { console.error(error); }
    })();
    return () => { cancelled = true; };
  }, [visible, rendered, pdfDoc, pageIndex]);

  const scaledW = dims.w * zoom;
  const scaledH = dims.h * zoom;

  const handleTextClick = (item: TextEditItem) => {
    const background = canvasRef.current ? samplePatchBackground(canvasRef.current, item, dims.w, dims.h) : '#ffffff';
    onEditTextItem(item, background);
  };

  return (
    <div className="relative mb-8 bg-white shadow-lg" style={{ width: scaledW, height: scaledH }} onClick={() => onSelect(null)}>
      <div ref={containerRef} className="relative origin-top-left bg-white" style={{ width: dims.w, height: dims.h, transform: `scale(${zoom})`, willChange: 'transform' }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />

        {textItems.map((item) => {
          const replacement = elements.find((element) => element.id === `replacement-${item.id}`);
          return <TextObject key={item.id} item={item} replacement={replacement} selected={selectedId === replacement?.id} onClick={() => handleTextClick(item)} onChange={(value) => replacement && onUpdate(replacement.id, { content: value })} onDelete={() => replacement && onDelete(replacement.id)} />;
        })}

        {formFields.map((field) => <PDFFormFieldControl key={field.id} field={field} value={formValues[field.fieldName]} onChange={(value) => onFormValueChange(field.fieldName, value)} onActivate={() => onSelect(null)} />)}
        {elements.filter((element) => !element.replaceOriginal).map((element) => <ResizableElement key={element.id} element={element} containerRef={containerRef} isSelected={selectedId === element.id} onSelect={() => onSelect(element.id)} onUpdate={onUpdate} onDelete={onDelete} />)}
      </div>
      <div className="pointer-events-none absolute -right-8 top-0 text-xs font-bold text-slate-300">{pageIndex + 1}</div>
    </div>
  );
};

const buildInitialFormValues = (fields: PdfFormFieldDefinition[]) => {
  const values: Record<string, PdfFormFieldValue> = {};
  fields.forEach((field) => { if (!(field.fieldName in values)) values[field.fieldName] = field.kind === 'checkbox' ? Boolean(field.value) : field.value; });
  return values;
};

export const EditPDF: React.FC = () => {
  const [file, setFile] = useState<PDFFile | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [elements, setElements] = useState<EditorElement[]>([]);
  const [formFields, setFormFields] = useState<PdfFormFieldDefinition[]>([]);
  const [formValues, setFormValues] = useState<Record<string, PdfFormFieldValue>>({});
  const [textItemsByPage, setTextItemsByPage] = useState<Record<number, TextEditItem[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>({ isProcessing: false, progress: 0, message: '' });
  const { zoom, zoomIn, zoomOut, resetZoom } = useZoom(1);

  const selectedElement = elements.find((element) => element.id === selectedId) || null;
  const fillableFieldCount = useMemo(() => new Set(formFields.map((field) => field.fieldName)).size, [formFields]);

  const handleFilesSelected = async (files: File[]) => {
    if (!files.length) return;
    const nextFile = files[0];
    setElements([]); setSelectedId(null); setFormFields([]); setFormValues({}); setTextItemsByPage({});
    setFile({ id: uuidv4(), file: nextFile, name: nextFile.name, size: nextFile.size });
    try {
      const doc = await loadPDFDocument(nextFile);
      setPdfDoc(doc);
      const fields = await getPdfFormFields(doc);
      setFormFields(fields); setFormValues(buildInitialFormValues(fields));
      const pages: Record<number, TextEditItem[]> = {};
      for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex += 1) {
        try {
          const items = await getPageTextEditItems(doc, pageIndex, 1);
          pages[pageIndex] = items.map((item, index) => ({ ...item, id: `text-${pageIndex}-${index}` }));
        } catch (error) { console.warn(`Unable to inspect page ${pageIndex + 1}`, error); }
      }
      setTextItemsByPage(pages);
    } catch (error) {
      console.error(error);
      setStatus({ isProcessing: false, progress: 0, message: '', error: 'Unable to open this PDF.' });
    }
  };

  useEffect(() => () => { if (pdfDoc?.destroy) void pdfDoc.destroy(); }, [pdfDoc]);

  const editExistingText = (item: TextEditItem, background: string) => {
    const id = `replacement-${item.id}`;
    const existing = elements.find((element) => element.id === id);
    if (existing) { setSelectedId(id); return; }
    const next: EditorElement = {
      id,
      type: 'text',
      pageIndex: Number(item.id.split('-')[1]),
      x: 0, y: 0,
      content: item.text,
      fontSize: item.fontSize,
      color: '#000000',
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight,
      fontStyle: item.fontStyle,
      ascent: item.ascent,
      replaceOriginal: true,
      originalWidth: 0,
      originalHeight: 0,
      originalBackground: background,
    };
    const pageIndex = next.pageIndex;
    void pdfDoc.getPage(pageIndex + 1).then((page: any) => {
      const viewport = page.getViewport({ scale: 1 });
      setElements((prev) => prev.some((element) => element.id === id) ? prev : [...prev, {
        ...next,
        x: item.left / viewport.width,
        y: item.top / viewport.height,
        originalWidth: item.width / viewport.width,
        originalHeight: item.height / viewport.height,
      }]);
      setSelectedId(id);
    });
  };

  const addText = () => {
    const next: EditorElement = { id: uuidv4(), type: 'text', pageIndex: 0, x: 0.1, y: 0.1, content: 'Text', fontSize: 16, color: '#000000' };
    setElements((prev) => [...prev, next]); setSelectedId(next.id);
  };

  const updateElement = (id: string, updates: Partial<EditorElement>) => setElements((prev) => prev.map((element) => element.id === id ? { ...element, ...updates } : element));
  const deleteElement = (id: string) => setElements((prev) => prev.filter((element) => element.id !== id));
  const updateFormValue = (name: string, value: PdfFormFieldValue) => setFormValues((prev) => ({ ...prev, [name]: value }));

  const handleSave = async () => {
    if (!file) return;
    setStatus({ isProcessing: true, progress: 20, message: 'Replacing PDF text...' });
    try {
      const bytes = await savePDFWithAnnotations(file.file, elements, formValues);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `edited-${file.name}`);
      setStatus({ isProcessing: false, progress: 100, message: 'PDF saved successfully.' });
    } catch (error) {
      console.error(error);
      setStatus({ isProcessing: false, progress: 0, message: '', error: 'Failed to save edited PDF.' });
    }
  };

  return (
    <div className="mx-auto flex h-[100dvh] min-h-[100dvh] max-w-6xl flex-col px-4 py-4 sm:py-6">
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div><Link to="/" className="text-sm font-medium text-slate-500 hover:text-slate-800">← Back</Link><h1 className="text-2xl font-bold">Edit PDF <span className="rounded bg-green-100 px-2 text-xs text-green-700">Safe</span></h1></div>
          {file && <div className="flex gap-2"><button onClick={addText} className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"><Type size={18} /> Text</button><button onClick={handleSave} disabled={status.isProcessing} className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 font-bold text-white disabled:opacity-50"><Save size={18} /> Save</button></div>}
        </div>
        {selectedElement?.type === 'text' && <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"><span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Selected text</span><input value={selectedElement.content} onChange={(event) => updateElement(selectedElement.id, { content: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><button onClick={() => selectedElement.replaceOriginal ? deleteElement(selectedElement.id) : setSelectedId(null)} title="Restore original / close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={16} /></button></div>}
        {file && <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{fillableFieldCount > 0 ? `Detected ${fillableFieldCount} fillable field${fillableFieldCount === 1 ? '' : 's'}. Click a text patch to edit it in place.` : 'Click any detected text patch to edit it in place. The saved PDF replaces the selected text instead of leaving a duplicate overlay.'}</div>}
      </div>

      <AnimatePresence mode="wait">
        {!file ? <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="m-auto w-full max-w-xl"><FileUpload onFilesSelected={handleFilesSelected} accept=".pdf" label="Drop PDF to edit" /></motion.div> : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="absolute bottom-6 right-6 z-30"><ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} /></div>
            <div className="custom-scrollbar flex flex-1 flex-col items-start overflow-auto p-4 sm:items-center sm:p-8">
              {Array.from({ length: pdfDoc?.numPages || 0 }).map((_, index) => <PDFPage key={index} pageIndex={index} pdfDoc={pdfDoc} elements={elements.filter((element) => element.pageIndex === index)} formFields={formFields.filter((field) => field.pageIndex === index)} formValues={formValues} textItems={textItemsByPage[index] || []} selectedId={selectedId} onSelect={setSelectedId} onEditTextItem={editExistingText} onUpdate={updateElement} onDelete={deleteElement} onFormValueChange={updateFormValue} zoom={zoom} />)}
              <div className="h-20" />
            </div>
          </div>
        )}
      </AnimatePresence>
      <StatusToast status={status} />
    </div>
  );
};
