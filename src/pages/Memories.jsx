import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  serverTimestamp, query, orderBy
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import SakuraBackground from '../components/SakuraBackground'
import styles from './Memories.module.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMemoryDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function getMonthYear(dateStr) {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function groupByMonth(memories) {
  const groups = []
  let lastMonth = null
  memories.forEach(m => {
    const month = getMonthYear(m.date)
    if (month !== lastMonth) {
      groups.push({ type: 'header', id: 'h-' + month, label: month })
      lastMonth = month
    }
    groups.push({ type: 'memory', ...m })
  })
  return groups
}

// Compress + convert image to base64 (keeps it under Firestore's 1MB doc limit)
function compressImage(file, maxWidth = 1000, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const base64 = canvas.toDataURL('image/jpeg', quality)
      URL.revokeObjectURL(url)
      resolve(base64)
    }
    img.onerror = reject
    img.src = url
  })
}

const TAG_OPTIONS = [
  { value: 'us',        label: '💑 Us' },
  { value: 'food',      label: '🍽️ Food' },
  { value: 'travel',    label: '✈️ Travel' },
  { value: 'home',      label: '🏠 Home' },
  { value: 'milestone', label: '🌟 Milestone' },
  { value: 'silly',     label: '😂 Silly' },
  { value: 'romantic',  label: '🌹 Romantic' },
  { value: 'other',     label: '📷 Other' },
]

const TAG_ICONS = {
  us: '💑', food: '🍽️', travel: '✈️', home: '🏠',
  milestone: '🌟', silly: '😂', romantic: '🌹', other: '📷',
}

// ─── Add Memory Modal ─────────────────────────────────────────────────────────

function AddMemoryModal({ onClose, onSave }) {
  const [caption, setCaption] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [tag, setTag] = useState('us')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const fileRef = useRef(null)

  function pickFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function handleSave() {
    if (!caption.trim()) return
    setSaving(true)
    let photoBase64 = null
    if (file) {
      setCompressing(true)
      photoBase64 = await compressImage(file)
      setCompressing(false)
    }
    await onSave({ caption: caption.trim(), date, tag, photoBase64 })
    setSaving(false)
    onClose()
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Add a memory 📸</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div
          className={`${styles.photoPicker} ${preview ? styles.photoPickerFilled : ''}`}
          onClick={() => fileRef.current?.click()}
        >
          {preview ? (
            <img src={preview} alt="preview" className={styles.photoPreview} />
          ) : (
            <div className={styles.photoPlaceholder}>
              <span className={styles.photoPlaceholderIcon}>📷</span>
              <p className={styles.photoPlaceholderText}>Tap to add a photo</p>
              <p className={styles.photoPlaceholderSub}>optional · auto-compressed</p>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickFile} />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Caption</label>
          <textarea
            className={styles.textarea}
            placeholder="What made this moment special…"
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={2}
            maxLength={280}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>When was this?</label>
          <input className={styles.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Tag</label>
          <div className={styles.catGrid}>
            {TAG_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`${styles.catBtn} ${tag === opt.value ? styles.catBtnActive : ''}`}
                onClick={() => setTag(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={!caption.trim() || saving}
        >
          {compressing ? 'Compressing photo…' : saving ? 'Saving…' : 'Save memory 💖'}
        </button>
      </div>
    </div>
  )
}

// ─── Memory Card ──────────────────────────────────────────────────────────────

function MemoryCard({ item, onDelete, onClick }) {
  return (
    <div className={styles.card} onClick={() => onClick(item)}>
      {item.photoBase64 && (
        <img src={item.photoBase64} alt={item.caption} className={styles.cardPhoto} loading="lazy" />
      )}
      <div className={styles.cardBody}>
        <div className={styles.cardMeta}>
          <span className={styles.cardTag}>{TAG_ICONS[item.tag] || '📷'} {item.tag}</span>
          <span className={styles.cardDate}>{formatMemoryDate(item.date)}</span>
        </div>
        <p className={styles.cardCaption}>{item.caption}</p>
      </div>
      <button
        className={styles.deleteBtn}
        onClick={e => { e.stopPropagation(); onDelete(item) }}
        title="Remove"
      >✕</button>
    </div>
  )
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ item, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.lightboxOverlay} onClick={onClose}>
      <div className={styles.lightbox} onClick={e => e.stopPropagation()}>
        {item.photoBase64 && (
          <img src={item.photoBase64} alt={item.caption} className={styles.lightboxPhoto} />
        )}
        <div className={styles.lightboxBody}>
          <p className={styles.lightboxCaption}>{item.caption}</p>
          <p className={styles.lightboxDate}>{formatMemoryDate(item.date)}</p>
        </div>
        <button className={styles.lightboxClose} onClick={onClose}>✕</button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Memories() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [lightboxItem, setLightboxItem] = useState(null)
  const [filterTag, setFilterTag] = useState('all')

  useEffect(() => {
    if (!user) return
    loadMemories()
  }, [user])

  async function loadMemories() {
    setLoading(true)
    try {
      const q = query(collection(db, 'memories'), orderBy('date', 'desc'))
      const snap = await getDocs(q)
      setMemories(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function saveMemory({ caption, date, tag, photoBase64 }) {
    await addDoc(collection(db, 'memories'), {
      caption,
      date,
      tag,
      photoBase64: photoBase64 || null,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    })
    loadMemories()
  }

  async function deleteMemory(item) {
    await deleteDoc(doc(db, 'memories', item.id))
    setMemories(prev => prev.filter(m => m.id !== item.id))
  }

  const filtered = filterTag === 'all' ? memories : memories.filter(m => m.tag === filterTag)
  const grouped = groupByMonth(filtered)
  const usedTags = [...new Set(memories.map(m => m.tag))]

  return (
    <div className={styles.page}>
      <SakuraBackground />
      <div className={styles.container}>

        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate('/dashboard')}>←</button>
          <div className={styles.headerCenter}>
            <span className={styles.headerEmoji}>📸</span>
            <h1 className={styles.headerTitle}>Our memories</h1>
          </div>
          <button className={styles.addHeaderBtn} onClick={() => setShowAdd(true)}>＋</button>
        </header>

        {memories.length > 0 && (
          <div className={styles.statsPill}>
            <span>{memories.length} moment{memories.length !== 1 ? 's' : ''} saved 💖</span>
          </div>
        )}

        {usedTags.length > 1 && (
          <div className={styles.filters}>
            <button className={`${styles.filterBtn} ${filterTag === 'all' ? styles.filterBtnActive : ''}`} onClick={() => setFilterTag('all')}>All</button>
            {usedTags.map(t => (
              <button key={t} className={`${styles.filterBtn} ${filterTag === t ? styles.filterBtnActive : ''}`} onClick={() => setFilterTag(t)}>
                {TAG_ICONS[t]} {t}
              </button>
            ))}
          </div>
        )}

        <div className={styles.timeline}>
          {loading && <p className={styles.loadingText}>Loading…</p>}

          {!loading && memories.length === 0 && (
            <div className={styles.empty}>
              <span className={styles.emptyEmoji}>📸</span>
              <p className={styles.emptyTitle}>No memories yet</p>
              <p className={styles.emptySub}>Start saving the little moments 💖</p>
              <button className={styles.emptyBtn} onClick={() => setShowAdd(true)}>Add your first memory</button>
            </div>
          )}

          {!loading && filtered.length === 0 && memories.length > 0 && (
            <div className={styles.empty}>
              <span className={styles.emptyEmoji}>{TAG_ICONS[filterTag]}</span>
              <p className={styles.emptyTitle}>No {filterTag} memories yet</p>
            </div>
          )}

          {grouped.map(item => {
            if (item.type === 'header') {
              return <div key={item.id} className={styles.monthHeader}><span>{item.label}</span></div>
            }
            return <MemoryCard key={item.id} item={item} onDelete={deleteMemory} onClick={setLightboxItem} />
          })}
        </div>

        <button className={styles.fab} onClick={() => setShowAdd(true)}>＋</button>
      </div>

      {showAdd && <AddMemoryModal onClose={() => setShowAdd(false)} onSave={saveMemory} />}
      {lightboxItem && <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />}
    </div>
  )
}
