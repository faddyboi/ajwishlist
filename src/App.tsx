import React, { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, doc, onSnapshot,
  addDoc, updateDoc, serverTimestamp, query, orderBy, setDoc, getDoc
} from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// ─── Types ────────────────────────────────────────────────────────────────────
interface User {
  id: string;
  name: string;
  starBalance?: number;
  fcmToken?: string;
}
interface Wish {
  id: string;
  ownerId: string;
  itemName: string;
  price: number;
  desireLevel: number;
  url: string;
  persuasionText: string;
  status: string;
  starCost: number;
  requestCount: number;
  createdAt: any;
  lastRequestedAt: any;
}
interface Activity {
  id: string;
  actorId: string;
  actionDescription: string;
  timestamp: any;
}

// ─── Firebase Setup ───────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDqCiKBERSp_ybqTPgHKGogW_uDywvwiDQ",
  authDomain: "jamie-andie-wishlist-claude.firebaseapp.com",
  projectId: "jamie-andie-wishlist-claude",
  storageBucket: "jamie-andie-wishlist-claude.firebasestorage.app",
  messagingSenderId: "377776890778",
  appId: "1:377776890778:web:4ea211b80a6fd9a367d023"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Messaging is initialised lazily inside functions so it never crashes
// on browsers that don't support it (e.g. Firefox private mode)
const getMsg = () => {
  try { return getMessaging(app); }
  catch { return null; }
};

const VAPID_KEY = "BJPXl8fjnrp93YU6hZaTuyAy8egsSIjIIgpXnG5i0J24gy_6clmFGLhWVubai6prPS4znWEqTHqTbsxt4LDA9m8";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg:        "#FAFAF8",
  card:      "#FFFFFF",
  blue:      "#B0C4DE",
  blueDark:  "#8AAAC8",
  blueLight: "#E8F0F8",
  pink:      "#FADADD",
  pinkDark:  "#F5B8BE",
  green:     "#E0F2F1",
  greenDark: "#A7D7D3",
  peach:     "#FFF0E8",
  text:      "#4A4A4A",
  sub:       "#8A8A8A",
  muted:     "#C4C4C4",
  border:    "#F0EEE9",
  white:     "#FFFFFF",
};
const FONT = "'Nunito', 'Inter', sans-serif";

const STATUS: Record<string, { bg: string; color: string }> = {
  Pending:     { bg: C.peach,     color: "#C97B4B" },
  Considering: { bg: "#FFF9E6",   color: "#B08A2A" },
  Approved:    { bg: C.green,     color: "#3A8C85" },
  Redeemed:    { bg: C.blueLight, color: "#5A85A8" },
};

const USERS = [
  { id: "jamie", name: "Jamie" },
  { id: "andie", name: "Andie" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (n: number | string) => `HK$${Number(n).toLocaleString()}`;
const fmt   = (ts: any): string => {
  if (!ts) return "";
  const ms   = ts?.toMillis ? ts.toMillis() : ts;
  const diff = Date.now() - ms;
  if (diff < 60000)    return "just now";
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
};

// ─── Push Notification Helpers ────────────────────────────────────────────────

// Step 1: ask permission + save this device's FCM token to Firestore
async function registerForPush(userId: string): Promise<void> {
  try {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const messaging = getMsg();
    if (!messaging) return;

    // Make sure our service worker is registered first
    const swReg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    const token  = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });

    if (token) {
      await updateDoc(doc(db, "users", userId), { fcmToken: token });
    }
  } catch (err) {
    // Notifications are a bonus — never crash the app over them
    console.warn("Push registration failed:", err);
  }
}

// Step 2: send a push via our Firebase Cloud Function (the secure middleman)
const CLOUD_FUNCTION_URL = "https://us-central1-jamie-andie-wishlist-claude.cloudfunctions.net/sendPushNotification";

async function sendPush(toToken: string, title: string, body: string): Promise<void> {
  if (!toToken) return;
  try {
    await fetch(CLOUD_FUNCTION_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ token: toToken, title, body }),
    });
  } catch (err) {
    console.warn("Push send failed:", err);
  }
}

// ─── Shared UI Atoms ──────────────────────────────────────────────────────────
function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={{
      position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
      background: C.text, color: C.white, padding: "13px 24px", borderRadius: 50,
      fontFamily: FONT, fontWeight: 700, fontSize: 14,
      boxShadow: "0 8px 30px rgba(74,74,74,0.18)", zIndex: 9999,
      animation: "toastIn .3s cubic-bezier(.22,1,.36,1)", whiteSpace: "nowrap",
    }}>{msg}</div>
  );
}

// Friendly in-app banner asking permission (shown after 3 s if not yet granted)
function NotifBanner({ onAllow, onDismiss }: { onAllow: () => void; onDismiss: () => void }) {
  return (
    <div style={{
      position: "fixed", top: 70, left: 16, right: 16, zIndex: 500,
      background: C.white, borderRadius: 18, padding: "16px 18px",
      boxShadow: "0 8px 32px rgba(180,180,160,0.25)", border: `1.5px solid ${C.blue}`,
      display: "flex", flexDirection: "column", gap: 12,
      animation: "toastIn .3s cubic-bezier(.22,1,.36,1)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>🔔</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.text, marginBottom: 4 }}>Enable Notifications</div>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
            Get notified when your partner adds a wish, sends a star, or approves something!
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onAllow} style={{
          flex: 1, background: C.blue, color: C.white, border: "none", borderRadius: 50,
          padding: "11px", fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer",
          boxShadow: `0 4px 16px ${C.blue}66`,
        }}>✅ Allow Notifications</button>
        <button onClick={onDismiss} style={{
          background: C.border, color: C.sub, border: "none", borderRadius: 50,
          padding: "11px 16px", fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer",
        }}>Later</button>
      </div>
    </div>
  );
}

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.card, borderRadius: 20, padding: "18px 20px",
      boxShadow: "0 4px 24px rgba(180,180,160,0.13), 0 1px 4px rgba(180,180,160,0.08)",
      border: `1px solid ${C.border}`, ...style,
    }}>{children}</div>
  );
}

function Btn({ children, onClick, variant = "primary", style = {}, disabled = false, fullWidth = false }:
  { children: React.ReactNode; onClick?: () => void; variant?: string; style?: React.CSSProperties; disabled?: boolean; fullWidth?: boolean }) {
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: C.blue,        color: C.white,    boxShadow: `0 4px 16px ${C.blue}66` },
    ghost:   { background: "transparent", color: C.blue,     border: `2px solid ${C.blue}` },
    soft:    { background: C.blueLight,   color: C.blueDark },
    muted:   { background: C.border,      color: C.sub },
    pink:    { background: C.pink,        color: C.pinkDark },
  };
  return (
    <button disabled={disabled} onClick={disabled ? undefined : onClick} style={{
      fontFamily: FONT, fontWeight: 700, fontSize: 14, border: "none", borderRadius: 50,
      padding: "12px 22px", cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1, transition: "all .18s ease",
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      width: fullWidth ? "100%" : "auto",
      ...variants[variant], ...style,
    }}>{children}</button>
  );
}

function PageHeader({ title, sub, onBack }: { title: string; sub?: string; onBack?: () => void }) {
  return (
    <div style={{ marginBottom: 24 }}>
      {onBack && (
        <button onClick={onBack} style={{
          fontFamily: FONT, fontWeight: 700, fontSize: 13, color: C.sub,
          background: "none", border: "none", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12, padding: 0,
        }}>← Back</button>
      )}
      <h1 style={{ fontFamily: FONT, fontSize: 24, fontWeight: 800, color: C.text, margin: 0 }}>{title}</h1>
      {sub && <p style={{ color: C.sub, margin: "5px 0 0", fontSize: 14, fontWeight: 600 }}>{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: C.text, margin: "0 0 12px" }}>{children}</h2>;
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { bg: C.border, color: C.sub };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "3px 11px", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
      {status}
    </span>
  );
}

function HeartBar({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <span key={n} style={{ fontSize: 15, color: n <= value ? C.pinkDark : C.muted }}>♥</span>
      ))}
    </span>
  );
}

function StarRater({ value, max = 10, onChange, size = 22 }: { value: number; max?: number; onChange?: (n: number) => void; size?: number }) {
  const [hov, setHov] = useState(0);
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <span key={n}
          onClick={() => onChange && onChange(n)}
          onMouseEnter={() => onChange && setHov(n)}
          onMouseLeave={() => onChange && setHov(0)}
          style={{ fontSize: size, cursor: onChange ? "pointer" : "default", color: n <= (hov || value) ? C.blue : C.muted, transition: "color .1s", lineHeight: 1 }}>★</span>
      ))}
    </div>
  );
}

function InputField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontFamily: FONT, fontWeight: 700, fontSize: 12, color: C.sub, marginBottom: 7, textTransform: "uppercase", letterSpacing: ".6px" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 15px", borderRadius: 14,
  border: `1.5px solid ${C.border}`, fontSize: 15, fontFamily: FONT,
  color: C.text, background: C.white, boxSizing: "border-box", outline: "none",
};

function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", gap: 16 }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", border: `3px solid ${C.blueLight}`, borderTopColor: C.blue, animation: "spin .8s linear infinite" }} />
      <p style={{ color: C.sub, fontFamily: FONT, fontWeight: 600, fontSize: 14 }}>Connecting to database…</p>
    </div>
  );
}

// ─── PAGE: Home ───────────────────────────────────────────────────────────────
function HomePage({ currentUser, users, wishes, onNavigate }: { currentUser: User; users: User[]; wishes: Wish[]; onNavigate: (page: string) => void }) {
  const partner       = users.find(u => u.id !== currentUser.id);
  const mine          = wishes.filter(w => w.ownerId === currentUser.id);
  const redeemed      = mine.filter(w => w.status === "Redeemed").length;
  const pct           = mine.length ? Math.round(redeemed / mine.length * 100) : 0;
  const partnerWishes = wishes
    .filter(w => w.ownerId !== currentUser.id)
    .sort((a, b) => {
      const ta = a.lastRequestedAt?.toMillis ? a.lastRequestedAt.toMillis() : (a.lastRequestedAt || 0);
      const tb = b.lastRequestedAt?.toMillis ? b.lastRequestedAt.toMillis() : (b.lastRequestedAt || 0);
      return tb - ta;
    });

  return (
    <div>
      <div style={{
        background: `linear-gradient(135deg, ${C.blue} 0%, #C8D8F0 100%)`,
        borderRadius: 24, padding: "28px 26px 24px", marginBottom: 20, color: C.white,
        position: "relative", overflow: "hidden", boxShadow: `0 8px 32px ${C.blue}55`,
      }}>
        <div style={{ position: "absolute", top: -20, right: -10, fontSize: 130, opacity: .12, lineHeight: 1 }}>★</div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", opacity: .85, marginBottom: 4 }}>YOUR STAR BALANCE</div>
        <div style={{ fontFamily: FONT, fontSize: 54, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>
          {currentUser.starBalance ?? 0}<span style={{ fontSize: 30, marginLeft: 6 }}>★</span>
        </div>
        <div style={{ fontSize: 13, opacity: .8, fontWeight: 600 }}>{currentUser.name}'s account</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[{ val: mine.length, label: "My Wishes" }, { val: `${pct}%`, label: "Redeemed" }].map(({ val, label }) => (
          <Card key={label} style={{ textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontFamily: FONT, fontSize: 34, fontWeight: 900, color: C.blue, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 700, marginTop: 4, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
          </Card>
        ))}
      </div>

      <SectionTitle>Quick Actions</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
        {[
          { label: "✨ Add Wish",    page: "add",      bg: C.blueLight, color: C.blueDark },
          { label: "🎁 Redemption", page: "redeem",   bg: C.green,     color: C.greenDark },
          { label: "⚖️ Evaluate",   page: "evaluate", bg: C.pink,      color: C.pinkDark },
          { label: "📋 My Wishes",  page: "mywishes", bg: C.peach,     color: "#C97B4B" },
        ].map(({ label, page, bg, color }) => (
          <button key={page} onClick={() => onNavigate(page)} style={{
            background: bg, border: "none", borderRadius: 16, padding: "16px 10px",
            fontFamily: FONT, fontWeight: 700, fontSize: 14, color, cursor: "pointer",
            textAlign: "center", boxShadow: "0 2px 12px rgba(180,180,160,0.1)",
          }}>{label}</button>
        ))}
      </div>

      <SectionTitle>💫 {partner?.name}'s Wishes</SectionTitle>
      {partnerWishes.length === 0
        ? <Card><p style={{ color: C.sub, textAlign: "center", padding: 12 }}>No wishes yet</p></Card>
        : partnerWishes.map(w => (
          <Card key={w.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text, flex: 1, marginRight: 8 }}>{w.itemName}</div>
              <StatusBadge status={w.status} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <HeartBar value={w.desireLevel} />
              <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{money(w.price)}</span>
              <span style={{ fontSize: 12, background: C.blueLight, color: C.blueDark, borderRadius: 12, padding: "2px 10px", fontWeight: 700 }}>
                {w.requestCount}x requested
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>{fmt(w.lastRequestedAt)}</div>
          </Card>
        ))
      }
    </div>
  );
}

// ─── PAGE: Add Wish ───────────────────────────────────────────────────────────
function AddWishPage({ onAdd, onBack }: { onAdd: (wish: Partial<Wish>) => Promise<void>; onBack: () => void }) {
  const [f, setF]       = useState({ itemName: "", price: "", desireLevel: 3, url: "", persuasionText: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));

  const handleSend = async () => {
    if (!f.itemName.trim()) return;
    setSaving(true);
    await onAdd({ ...f, price: parseFloat(f.price) || 0 });
    setSaving(false);
  };

  return (
    <div>
      <PageHeader title="New Wish ✨" sub="Tell your partner what you're dreaming about" onBack={onBack} />
      <Card style={{ marginBottom: 14 }}>
        <InputField label="Item Name *">
          <input value={f.itemName} onChange={e => set("itemName", e.target.value)} placeholder="e.g. Sony Headphones" style={inputStyle} />
        </InputField>
        <InputField label="Price (HK$)">
          <input value={f.price} onChange={e => set("price", e.target.value)} type="number" placeholder="0" style={inputStyle} />
        </InputField>
        <InputField label="Desire Level">
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => set("desireLevel", n)} style={{
                width: 42, height: 42, borderRadius: 12, cursor: "pointer",
                border: `2px solid ${n <= f.desireLevel ? C.pinkDark : C.border}`,
                background: n <= f.desireLevel ? C.pink : C.white,
                color: n <= f.desireLevel ? C.pinkDark : C.muted,
                fontSize: 18, fontWeight: 700, transition: "all .12s",
              }}>♥</button>
            ))}
          </div>
        </InputField>
        <InputField label="Buy URL">
          <input value={f.url} onChange={e => set("url", e.target.value)} placeholder="https://..." style={inputStyle} />
        </InputField>
        <InputField label="Persuade Me 😏">
          <textarea value={f.persuasionText} onChange={e => set("persuasionText", e.target.value)}
            placeholder="Make your case… why do you NEED this?" rows={4}
            style={{ ...inputStyle, resize: "vertical" as any }} />
        </InputField>
      </Card>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn onClick={handleSend} fullWidth disabled={saving}>{saving ? "Sending…" : "💌 Send to Partner"}</Btn>
        <Btn variant="muted" onClick={onBack} fullWidth>Maybe Later</Btn>
      </div>
    </div>
  );
}

// ─── PAGE: My Wishlist ────────────────────────────────────────────────────────
function MyWishlistPage({ currentUser, wishes, onBack, onRequestAgain }: { currentUser: User; wishes: Wish[]; onBack: () => void; onRequestAgain: (id: string) => Promise<void> }) {
  const mine = wishes.filter(w => w.ownerId === currentUser.id);
  return (
    <div>
      <PageHeader title="My Wishlist 📋" sub={`${mine.length} wishes total`} onBack={onBack} />
      {mine.length === 0
        ? <Card><p style={{ color: C.sub, textAlign: "center", padding: 20 }}>No wishes yet — add one!</p></Card>
        : mine.map(w => (
          <Card key={w.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{w.itemName}</div>
              <StatusBadge status={w.status} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <HeartBar value={w.desireLevel} />
              <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{money(w.price)}</span>
              {w.starCost > 0 && (
                <span style={{ fontSize: 12, color: C.blueDark, fontWeight: 700, background: C.blueLight, borderRadius: 12, padding: "2px 9px" }}>
                  {w.starCost} ★ cost
                </span>
              )}
            </div>
            {w.status !== "Redeemed"
              ? <Btn variant="soft" onClick={() => onRequestAgain(w.id)} style={{ fontSize: 13, padding: "9px 18px" }}>🔁 Request Again ({w.requestCount}x)</Btn>
              : <span style={{ fontSize: 13, color: C.greenDark, fontWeight: 700 }}>✓ Redeemed</span>
            }
          </Card>
        ))
      }
    </div>
  );
}

// ─── PAGE: Evaluate ───────────────────────────────────────────────────────────
function EvaluatePage({ currentUser, wishes, onBack, onEvaluate }: { currentUser: User; wishes: Wish[]; onBack: () => void; onEvaluate: (id: string, status: string, cost: number) => Promise<void> }) {
  const [costs, setCosts]   = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const pending = wishes.filter(w => w.ownerId !== currentUser.id && ["Pending", "Considering"].includes(w.status));

  const handle = async (wishId: string, status: string) => {
    setSaving(wishId + status);
    await onEvaluate(wishId, status, costs[wishId] || 0);
    setSaving(null);
  };

  return (
    <div>
      <PageHeader title="Partner Evaluation ⚖️" sub={`${pending.length} wishes await your verdict`} onBack={onBack} />
      {pending.length === 0
        ? <Card><p style={{ color: C.sub, textAlign: "center", padding: 24 }}>All caught up! No pending wishes.</p></Card>
        : pending.map(w => (
          <Card key={w.id} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.text, flex: 1, marginRight: 8 }}>{w.itemName}</div>
              <StatusBadge status={w.status} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <HeartBar value={w.desireLevel} />
              <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{money(w.price)}</span>
              <span style={{ fontSize: 12, background: C.blueLight, color: C.blueDark, borderRadius: 12, padding: "2px 9px", fontWeight: 700 }}>{w.requestCount}x requested</span>
            </div>
            {w.url && (
              <a href={w.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: C.blue, fontWeight: 700, display: "block", marginBottom: 10 }}>🔗 View Product</a>
            )}
            {w.persuasionText && (
              <div style={{ background: C.pink, borderRadius: 14, padding: "12px 15px", fontSize: 13, color: C.text, marginBottom: 14, fontStyle: "italic", lineHeight: 1.55 }}>
                "{w.persuasionText}"
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: C.sub, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".5px" }}>Assign Star Cost (1–10)</div>
              <StarRater value={costs[w.id] || 0} onChange={v => setCosts(p => ({ ...p, [w.id]: v }))} />
              {(costs[w.id] || 0) > 0 && (
                <div style={{ fontSize: 12, color: C.sub, marginTop: 5, fontWeight: 600 }}>{costs[w.id]} star{costs[w.id] > 1 ? "s" : ""} to redeem</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="muted" onClick={() => handle(w.id, "Considering")} disabled={saving === w.id + "Considering"} style={{ fontSize: 13, padding: "9px 16px" }}>🧠 Considering</Btn>
              <Btn onClick={() => handle(w.id, "Approved")} disabled={saving === w.id + "Approved"} style={{ fontSize: 13, padding: "9px 16px" }}>🚀 Approve Wish</Btn>
            </div>
          </Card>
        ))
      }
    </div>
  );
}

// ─── PAGE: Redemption Center ──────────────────────────────────────────────────
function RedeemPage({ currentUser, wishes, onBack, onRedeem }: { currentUser: User; wishes: Wish[]; onBack: () => void; onRedeem: (id: string) => Promise<void> }) {
  const [tab, setTab]       = useState("All");
  const [saving, setSaving] = useState<string | null>(null);
  const mine  = wishes.filter(w => w.ownerId === currentUser.id);
  const shown = tab === "All" ? mine : mine.filter(w => w.status === tab);

  const handle = async (wishId: string) => {
    setSaving(wishId);
    await onRedeem(wishId);
    setSaving(null);
  };

  return (
    <div>
      <PageHeader title="Redemption Center 🎁" onBack={onBack} />
      <div style={{
        background: `linear-gradient(135deg, ${C.blue} 0%, #C8D8F0 100%)`,
        borderRadius: 18, padding: "18px 22px", marginBottom: 20, color: C.white, boxShadow: `0 6px 24px ${C.blue}44`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1px", opacity: .85, marginBottom: 2 }}>YOUR BALANCE</div>
        <div style={{ fontFamily: FONT, fontSize: 42, fontWeight: 900 }}>{currentUser.starBalance ?? 0} ★</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["All", "Approved", "Considering"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "9px 18px", borderRadius: 50, fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer",
            border: `2px solid ${tab === t ? C.blue : C.border}`,
            background: tab === t ? C.blue : C.white, color: tab === t ? C.white : C.sub,
          }}>{t}</button>
        ))}
      </div>
      {shown.length === 0
        ? <Card><p style={{ color: C.sub, textAlign: "center", padding: 20 }}>No wishes here</p></Card>
        : shown.map(w => (
          <Card key={w.id} style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 5 }}>{w.itemName}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{money(w.price)}</span>
                {w.starCost > 0 && (
                  <span style={{ fontSize: 12, background: C.blueLight, color: C.blueDark, borderRadius: 12, padding: "2px 9px", fontWeight: 700 }}>{w.starCost} ★</span>
                )}
                <StatusBadge status={w.status} />
              </div>
            </div>
            {w.status === "Approved" && (
              <Btn onClick={() => handle(w.id)} disabled={saving === w.id} style={{ fontSize: 13, padding: "9px 18px", flexShrink: 0 }}>
                {saving === w.id ? "…" : "Redeem"}
              </Btn>
            )}
          </Card>
        ))
      }
    </div>
  );
}

// ─── PAGE: Rewards ────────────────────────────────────────────────────────────
function RewardsPage({ currentUser, users, activities, onBack, onSendStar }: { currentUser: User; users: User[]; activities: Activity[]; onBack: () => void; onSendStar: () => Promise<void> }) {
  const partner  = users.find(u => u.id !== currentUser.id);
  const sorted   = [...activities].sort((a, b) => {
    const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp || 0);
    const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp || 0);
    return tb - ta;
  });
  const actorName = (id: string) => users.find(u => u.id === id)?.name || id;
  const avatarBg: Record<string, string> = { jamie: C.blueLight, andie: C.pink };

  return (
    <div>
      <PageHeader title="Stars & Rewards ⭐" sub="Send love, track activity" onBack={onBack} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[currentUser, partner].filter(Boolean).map((u, i) => u && (
          <Card key={u.id} style={{ textAlign: "center", padding: "20px 12px", border: i === 0 ? `2px solid ${C.blue}` : `1px solid ${C.border}` }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: i === 0 ? C.blue : C.pink, color: i === 0 ? C.white : C.pinkDark,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 900, fontSize: 16, margin: "0 auto 10px",
            }}>{u.name[0]}</div>
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 700, marginBottom: 4 }}>{u.name}{i === 0 ? " (You)" : ""}</div>
            <div style={{ fontFamily: FONT, fontSize: 34, fontWeight: 900, color: C.blue }}>{u.starBalance ?? 0}</div>
            <div style={{ fontSize: 12, color: C.muted }}>stars</div>
          </Card>
        ))}
      </div>
      <div style={{
        background: `linear-gradient(135deg, ${C.blue} 0%, #C8D8F0 100%)`,
        borderRadius: 20, padding: "22px 24px", marginBottom: 28, textAlign: "center", boxShadow: `0 6px 24px ${C.blue}44`,
      }}>
        <div style={{ fontSize: 13, color: C.white, fontWeight: 700, opacity: .85, marginBottom: 12 }}>Show {partner?.name} some love!</div>
        <button onClick={onSendStar} style={{
          background: C.white, color: C.blue, border: "none", borderRadius: 50,
          padding: "14px 32px", fontFamily: FONT, fontWeight: 800, fontSize: 16,
          cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
          display: "inline-flex", alignItems: "center", gap: 8,
        }}>⭐ Send a Star to {partner?.name}!</button>
      </div>
      <SectionTitle>Global Activity Feed</SectionTitle>
      {sorted.length === 0
        ? <Card><p style={{ color: C.sub, textAlign: "center", padding: 16 }}>No activity yet</p></Card>
        : sorted.map(a => (
          <Card key={a.id} style={{ marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px" }}>
            <div style={{
              width: 38, height: 38, borderRadius: "50%", background: avatarBg[a.actorId] || C.blueLight,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 900, fontSize: 15, flexShrink: 0, color: C.text,
            }}>{actorName(a.actorId)[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>{actorName(a.actorId)}</div>
              <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{a.actionDescription}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{fmt(a.timestamp)}</div>
            </div>
          </Card>
        ))
      }
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { page: "home",     icon: "🏠", label: "Home"     },
  { page: "mywishes", icon: "📋", label: "Wishes"   },
  { page: "evaluate", icon: "⚖️", label: "Evaluate" },
  { page: "redeem",   icon: "🎁", label: "Redeem"   },
  { page: "rewards",  icon: "⭐", label: "Stars"    },
];

function BottomNav({ page, onNavigate }: { page: string; onNavigate: (page: string) => void }) {
  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0, background: C.white,
      borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-around",
      alignItems: "center", padding: "8px 4px 12px",
      boxShadow: "0 -4px 24px rgba(180,180,160,0.12)", zIndex: 100,
    }}>
      {NAV_ITEMS.map(({ page: p, icon, label }) => {
        const active = page === p;
        return (
          <button key={p} onClick={() => onNavigate(p)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            background: "none", border: "none", cursor: "pointer", padding: "4px 10px", borderRadius: 14,
          }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: active ? 800 : 600, color: active ? C.blue : C.muted }}>{label}</span>
            {active && <div style={{ width: 20, height: 3, borderRadius: 3, background: C.blue, marginTop: 1 }} />}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
const urlUser = (() => {
    // 1. Check the URL parameter first
    const p = new URLSearchParams(window.location.search).get("user");
    if (p === "jamie" || p === "andie") {
      // 2. If found, save it to localStorage for future PWA launches
      localStorage.setItem("wishlist_user", p);
      return p;
    }
    // 3. No URL param (e.g. opened from home screen) — check localStorage
    const saved = localStorage.getItem("wishlist_user");
    if (saved === "jamie" || saved === "andie") return saved;
    // 4. Absolute fallback
    return "jamie";
  })();

  const [users,           setUsers]           = useState<User[]>([]);
  const [wishes,          setWishes]          = useState<Wish[]>([]);
  const [activities,      setActivities]      = useState<Activity[]>([]);
  const [userId]                              = useState<string>(urlUser);
  const [page,            setPage]            = useState("home");
  const [toast,           setToast]           = useState<string | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [showNotifBanner, setShowNotifBanner] = useState(false);

  const currentUser: User = users.find(u => u.id === userId) || { id: userId, name: userId === "jamie" ? "Jamie" : "Andie", starBalance: 0 };
  const partner:     User = users.find(u => u.id !== userId) || { id: userId === "jamie" ? "andie" : "jamie", name: userId === "jamie" ? "Andie" : "Jamie", starBalance: 0 };

  const showToast = (msg: string) => setToast(msg);

  // ── Seed user docs ──────────────────────────────────────────────────────────
  useEffect(() => {
    const seed = async () => {
      for (const u of USERS) {
        const ref  = doc(db, "users", u.id);
        const snap = await getDoc(ref);
        if (!snap.exists()) await setDoc(ref, { name: u.name, starBalance: 0 });
      }
    };
    seed();
  }, []);

  // ── Real-time listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "users"), snap => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
      setLoading(false);
    });
    const unsubWishes = onSnapshot(collection(db, "wishes"), snap => {
      setWishes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Wish)));
    });
    const unsubActs = onSnapshot(
      query(collection(db, "activities"), orderBy("timestamp", "desc")),
      snap => setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() } as Activity)))
    );
    return () => { unsubUsers(); unsubWishes(); unsubActs(); };
  }, []);

  // ── Show notification banner after 3 s if permission not yet decided ────────
  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      const t = setTimeout(() => setShowNotifBanner(true), 3000);
      return () => clearTimeout(t);
    }
  }, []);

  // ── Handle foreground push messages (app is open) ───────────────────────────
  useEffect(() => {
    const messaging = getMsg();
    if (!messaging) return;
    const unsub = onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "";
      const body  = payload.notification?.body  ?? "";
      if (title) showToast(`${title} ${body}`);
    });
    return unsub;
  }, []);

  // ── Activity logger ─────────────────────────────────────────────────────────
  const logActivity = useCallback(async (actorId: string, desc: string) => {
    await addDoc(collection(db, "activities"), { actorId, actionDescription: desc, timestamp: serverTimestamp() });
  }, []);

  // ── Get partner's FCM token from Firestore ──────────────────────────────────
  const getPartnerToken = async (): Promise<string | null> => {
    const snap = await getDoc(doc(db, "users", partner.id));
    return (snap.data()?.fcmToken as string) ?? null;
  };

  // ── App actions ─────────────────────────────────────────────────────────────
  const handleAddWish = async ({ itemName, price, desireLevel, url, persuasionText }: Partial<Wish>) => {
    await addDoc(collection(db, "wishes"), {
      ownerId: userId, itemName, price, desireLevel, url, persuasionText,
      status: "Pending", starCost: 0, requestCount: 1,
      createdAt: serverTimestamp(), lastRequestedAt: serverTimestamp(),
    });
    await logActivity(userId, `Added a new wish: ${itemName}`);
    const token = await getPartnerToken();
    if (token) await sendPush(token, `✨ ${currentUser.name} added a new wish!`, `"${itemName}" — go take a look 👀`);
    showToast("Wish sent! 💌");
    setPage("home");
  };

  const handleRequestAgain = async (wishId: string) => {
    const w = wishes.find(x => x.id === wishId);
    await updateDoc(doc(db, "wishes", wishId), { requestCount: (w?.requestCount || 1) + 1, lastRequestedAt: serverTimestamp() });
    await logActivity(userId, `${w?.itemName} was requested again!`);
    const token = await getPartnerToken();
    if (token) await sendPush(token, `💌 ${currentUser.name} really wants something…`, `They requested "${w?.itemName}" again!`);
    showToast("Request sent again! 🔁");
  };

  const handleEvaluate = async (wishId: string, status: string, starCost: number) => {
    const w = wishes.find(x => x.id === wishId);
    await updateDoc(doc(db, "wishes", wishId), { status, starCost });
    await logActivity(userId, `${status === "Approved" ? "Approved" : "Considering"}: ${w?.itemName}`);
    if (status === "Approved") {
      const token = await getPartnerToken();
      if (token) await sendPush(token, `🚀 Your wish was approved!`, `"${w?.itemName}" — check your Redemption Center 🎁`);
    }
    showToast(status === "Considering" ? "Considering! 🧠" : "Approved! 🚀");
  };

  const handleRedeem = async (wishId: string) => {
    const w = wishes.find(x => x.id === wishId);
    if (!w) return;
    if ((currentUser.starBalance ?? 0) < w.starCost) {
      showToast(`Not enough stars! Need ${w.starCost}★, you have ${currentUser.starBalance ?? 0}★`);
      return;
    }
    await updateDoc(doc(db, "users", userId), { starBalance: (currentUser.starBalance ?? 0) - w.starCost });
    await updateDoc(doc(db, "wishes", wishId), { status: "Redeemed" });
    await logActivity(userId, `Redeemed: ${w.itemName} for ${w.starCost}★`);
    showToast(`Redeemed! 🎉 -${w.starCost}★`);
  };

  const handleSendStar = async () => {
    await updateDoc(doc(db, "users", partner.id), { starBalance: (partner.starBalance ?? 0) + 1 });
    await logActivity(userId, `Sent ${partner.name} a ⭐ Star!`);
    const token = await getPartnerToken();
    if (token) await sendPush(token, `⭐ ${currentUser.name} sent you a star!`, `Your balance just went up 🎉`);
    showToast("Star has been sent! ⭐");
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: ${C.bg}; font-family: ${FONT}; color: ${C.text}; -webkit-font-smoothing: antialiased; }
        @keyframes toastIn { from { opacity:0; transform:translate(-50%,12px); } to { opacity:1; transform:translate(-50%,0); } }
        @keyframes spin    { to { transform: rotate(360deg); } }
        input:focus, textarea:focus { border-color: ${C.blue} !important; box-shadow: 0 0 0 3px ${C.blue}30 !important; }
        button { font-family: ${FONT}; }
        ::-webkit-scrollbar { width: 0; }
      `}</style>

      {/* Top Nav */}
      <header style={{
        background: C.white, borderBottom: `1px solid ${C.border}`,
        padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, zIndex: 200, boxShadow: "0 2px 16px rgba(180,180,160,0.1)",
      }}>
        <div onClick={() => setPage("home")} style={{ fontFamily: FONT, fontSize: 18, fontWeight: 900, color: C.blue, cursor: "pointer", userSelect: "none" }}>
          ★ Wishlist
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: C.blueLight, borderRadius: 50, padding: "7px 14px 7px 10px", border: `2px solid ${C.blue}`,
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: "50%",
            background: userId === "jamie" ? C.blue : C.pink,
            color: userId === "jamie" ? C.white : C.pinkDark,
            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13,
          }}>{currentUser.name[0]}</div>
          <span style={{ fontFamily: FONT, fontWeight: 800, fontSize: 14, color: C.blueDark }}>{currentUser.name}</span>
        </div>
      </header>

      {/* Notification permission banner */}
      {showNotifBanner && (
        <NotifBanner
          onAllow={async () => { setShowNotifBanner(false); await registerForPush(userId); }}
          onDismiss={() => setShowNotifBanner(false)}
        />
      )}

      {/* Page content */}
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px 100px" }}>
        {loading ? <Spinner /> : (
          <>
            {page === "home"     && <HomePage      currentUser={currentUser} users={users} wishes={wishes} onNavigate={setPage} />}
            {page === "add"      && <AddWishPage   onAdd={handleAddWish} onBack={() => setPage("home")} />}
            {page === "mywishes" && <MyWishlistPage currentUser={currentUser} wishes={wishes} onBack={() => setPage("home")} onRequestAgain={handleRequestAgain} />}
            {page === "evaluate" && <EvaluatePage  currentUser={currentUser} wishes={wishes} onBack={() => setPage("home")} onEvaluate={handleEvaluate} />}
            {page === "redeem"   && <RedeemPage    currentUser={currentUser} wishes={wishes} onBack={() => setPage("home")} onRedeem={handleRedeem} />}
            {page === "rewards"  && <RewardsPage   currentUser={currentUser} users={users} activities={activities} onBack={() => setPage("home")} onSendStar={handleSendStar} />}
          </>
        )}
      </main>

      <BottomNav page={page} onNavigate={setPage} />
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </>
  );
}
