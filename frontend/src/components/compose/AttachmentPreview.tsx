import { useEffect, useState, type ChangeEvent, type RefObject } from 'react'
import { FileText, X } from 'lucide-react'

export interface ComposeAttachment {
  id: string
  file: File
}

export interface AttachmentPreviewProps {
  attachments: ComposeAttachment[]
  inputRef: RefObject<HTMLInputElement>
  error: string
  isUploading: boolean
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

export default function AttachmentPreview({ attachments, inputRef, error, isUploading, onAdd, onRemove }: AttachmentPreviewProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onAdd(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  return (
    <section className="compose-attachments" aria-label="Attachments">
      <input ref={inputRef} className="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,image/png,image/jpeg,image/gif,image/webp" multiple disabled={isUploading} onChange={handleChange} />
      {attachments.map(attachment => (
        <AttachmentChip key={attachment.id} attachment={attachment} isUploading={isUploading} onRemove={onRemove} />
      ))}
      {error && <span className="attachment-error" role="alert">{error}</span>}
    </section>
  )
}

function AttachmentChip({ attachment, isUploading, onRemove }: {
  attachment: ComposeAttachment
  isUploading: boolean
  onRemove: (id: string) => void
}) {
  const isImage = attachment.file.type.startsWith('image/')
  const [previewUrl, setPreviewUrl] = useState<string>()

  useEffect(() => {
    if (!isImage) return
    const url = URL.createObjectURL(attachment.file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [attachment.file, isImage])

  return (
    <div className={`compose-attachment ${isImage ? 'is-image' : ''}`}>
      {isImage && previewUrl
        ? <img className="compose-attachment-thumbnail" src={previewUrl} alt={`Preview of ${attachment.file.name}`} />
        : <FileText className="compose-attachment-file-icon" size={13} aria-hidden="true" />}
      <span title={attachment.file.name}>{attachment.file.name}</span>
      <small>{formatFileSize(attachment.file.size)}</small>
      <small className="compose-attachment-status" role="status">{isUploading ? 'Uploading…' : 'Ready'}</small>
      <button className="compose-attachment-remove" type="button" disabled={isUploading} onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.file.name}`} title={`Remove ${attachment.file.name}`}><X size={12} /></button>
    </div>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
