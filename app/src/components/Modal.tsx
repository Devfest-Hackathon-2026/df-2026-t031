// 2026-11-10 期間内に書き直し。
// 画面中央に出す小窓。<dialog> の showModal を使い、Esc・外側のクリック・×ボタンで閉じる。
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export default function Modal({ title, onClose, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // 出したときに開き、消えるときに閉じる
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onCancel={onClose}
      onClick={(event) => {
        // 背景（dialog 自身）を押したときだけ閉じる。中身のクリックは無視
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="閉じる" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  )
}
