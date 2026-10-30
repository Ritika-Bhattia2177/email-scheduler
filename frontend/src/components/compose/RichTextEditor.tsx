import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from 'lucide-react'

export interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  linkRequest: number
}

export default function RichTextEditor({ value, onChange, linkRequest }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value
  }, [value])

  useEffect(() => {
    if (linkRequest > 0) openLinkInput()
  }, [linkRequest])

  function saveSelection() {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    if (editor.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange()
  }

  function openLinkInput() {
    saveSelection()
    setLinkError('')
    setShowLinkInput(true)
  }

  function runCommand(command: string, commandValue?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, commandValue)
    if (editorRef.current) onChange(editorRef.current.innerHTML)
  }

  function applyLink() {
    const candidate = linkUrl.trim()
    let parsedUrl: URL
    try {
      parsedUrl = new URL(candidate)
    } catch {
      setLinkError('Enter a valid URL, such as https://example.com.')
      return
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'mailto:') {
      setLinkError('Enter a valid web or email link.')
      return
    }

    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    const savedRange = savedRangeRef.current
    if (selection && savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      selection.removeAllRanges()
      selection.addRange(savedRange)
    }
    if (selection?.rangeCount && selection.isCollapsed) {
      const range = selection.getRangeAt(0)
      const linkText = document.createTextNode(candidate)
      range.insertNode(linkText)
      range.selectNodeContents(linkText)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    document.execCommand('createLink', false, parsedUrl.href)
    onChange(editor.innerHTML)
    savedRangeRef.current = null
    setLinkUrl('')
    setLinkError('')
    setShowLinkInput(false)
  }

  function preserveSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
  }

  return (
    <section className="compose-editor" aria-label="Message editor">
      <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
        <ToolbarButton label="Bold" onMouseDown={preserveSelection} onClick={() => runCommand('bold')}><Bold /></ToolbarButton>
        <ToolbarButton label="Italic" onMouseDown={preserveSelection} onClick={() => runCommand('italic')}><Italic /></ToolbarButton>
        <ToolbarButton label="Underline" onMouseDown={preserveSelection} onClick={() => runCommand('underline')}><Underline /></ToolbarButton>
        <ToolbarButton label="Strikethrough" onMouseDown={preserveSelection} onClick={() => runCommand('strikeThrough')}><Strikethrough /></ToolbarButton>
        <span className="editor-toolbar-divider" />
        <ToolbarButton label="Bulleted list" onMouseDown={preserveSelection} onClick={() => runCommand('insertUnorderedList')}><List /></ToolbarButton>
        <ToolbarButton label="Numbered list" onMouseDown={preserveSelection} onClick={() => runCommand('insertOrderedList')}><ListOrdered /></ToolbarButton>
        <span className="editor-toolbar-divider" />
        <ToolbarButton label="Align left" onMouseDown={preserveSelection} onClick={() => runCommand('justifyLeft')}><AlignLeft /></ToolbarButton>
        <ToolbarButton label="Align center" onMouseDown={preserveSelection} onClick={() => runCommand('justifyCenter')}><AlignCenter /></ToolbarButton>
        <ToolbarButton label="Align right" onMouseDown={preserveSelection} onClick={() => runCommand('justifyRight')}><AlignRight /></ToolbarButton>
        <span className="editor-toolbar-divider" />
        <ToolbarButton label="Insert link" onMouseDown={preserveSelection} onClick={openLinkInput}><Link2 /></ToolbarButton>
        <ToolbarButton label="Clear formatting" onMouseDown={preserveSelection} onClick={() => runCommand('removeFormat')}><RemoveFormatting /></ToolbarButton>
      </div>
      {showLinkInput && (
        <div className="editor-link-input">
          <div className="editor-link-field">
            <input
              type="url"
              value={linkUrl}
              onChange={event => { setLinkUrl(event.target.value); setLinkError('') }}
              onFocus={saveSelection}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink() } }}
              placeholder="https://example.com"
              aria-label="Link URL"
              aria-invalid={Boolean(linkError)}
            />
            {linkError && <span className="editor-link-error" role="alert">{linkError}</span>}
          </div>
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={applyLink}>Insert</button>
          <button className="editor-link-cancel" type="button" onClick={() => { setShowLinkInput(false); setLinkError('') }}>Cancel</button>
        </div>
      )}
      <div
        ref={editorRef}
        className="editor-content"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Email body"
        aria-multiline="true"
        data-placeholder="Type Your Reply..."
        onInput={event => onChange(event.currentTarget.innerHTML)}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
      />
    </section>
  )
}

interface ToolbarButtonProps {
  label: string
  onClick: () => void
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}

function ToolbarButton({ label, onClick, onMouseDown, children }: ToolbarButtonProps) {
  return <button className="editor-tool" type="button" aria-label={label} title={label} onMouseDown={onMouseDown} onClick={onClick}>{children}</button>
}
