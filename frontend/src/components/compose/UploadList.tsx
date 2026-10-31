import { useState, type ChangeEvent } from 'react'
import { FileText, Trash2, Upload } from 'lucide-react'

export interface UploadListProps {
  onFileUpload: (emails: string[]) => void
  onRemoveUpload: (emails: string[]) => void
}

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export default function UploadList({ onFileUpload, onRemoveUpload }: UploadListProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [detectedCount, setDetectedCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [uploadedEmails, setUploadedEmails] = useState<string[]>([])

  function removeUpload() {
    onRemoveUpload(uploadedEmails)
    setUploadedEmails([])
    setSelectedFile(null)
    setDetectedCount(null)
    setError('')
  }

  function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (uploadedEmails.length > 0) onRemoveUpload(uploadedEmails)
    setUploadedEmails([])
    setSelectedFile(file)
    setDetectedCount(null)
    setError('')

    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Choose a .csv or .txt file.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const contents = typeof reader.result === 'string' ? reader.result : ''
      const matches = contents.match(emailPattern) ?? []
      const uniqueEmails = [...new Map(matches.map(email => [email.toLowerCase(), email])).values()]
      if (uniqueEmails.length === 0) {
        setError('No valid email addresses found in this file.')
        return
      }
      setDetectedCount(uniqueEmails.length)
      setUploadedEmails(uniqueEmails)
      onFileUpload(uniqueEmails)
    }
    reader.onerror = () => setError('Could not read this file.')
    reader.readAsText(file)
  }

  return (
    <div className="upload-list-control">
      <label className="upload-list-button">
        <Upload size={13} />
        <span>Upload List</span>
        <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={readFile} aria-label="Upload recipient list" />
      </label>
      <span className="upload-list-formats">CSV / TXT</span>
      {selectedFile && <span className="upload-list-filename" title={selectedFile.name}><FileText size={11} />{selectedFile.name}</span>}
      {detectedCount !== null && <span className="upload-list-result">{detectedCount} email {detectedCount === 1 ? 'address' : 'addresses'} detected</span>}
      {selectedFile && <button type="button" className="upload-list-remove" onClick={removeUpload} aria-label="Remove uploaded recipient list"><Trash2 size={13} /><span>Remove list</span></button>}
      {error && <span className="compose-field-error" role="alert">{error}</span>}
    </div>
  )
}
