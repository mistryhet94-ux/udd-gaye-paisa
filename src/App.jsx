import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, X, TrendingUp, TrendingDown, Calendar, Repeat,
  Target, ChevronLeft, ChevronRight, Trash2, Edit2, Check,
  Wallet, ArrowUpRight, ArrowDownRight, AlertCircle, Bell, BellOff, BarChart2
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#0b0d10', minHeight: '100vh', padding: 20 }}>
          <h2 style={{ color: '#f87171', marginBottom: 12 }}>App Error</h2>
          <pre style={{ color: '#fca5a5', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error.message}{'\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const SUPABASE_URL = 'https://qlywaulgkggdzsxmxsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bxzYk0vQ0izYWFRyKLMD2w_d3wf7zTV';

// Minimal Supabase REST client (no SDK dependency — works in any environment)
function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbFetch(url, options) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.text()) || msg; } catch (_) {}
      return { data: null, error: { message: `${res.status}: ${msg}` } };
    }
    if (res.status === 204) return { data: null, error: null };
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { message: e.message || 'Network error' } };
  }
}

const supabase = {
  from(table) {
    const base = `${SUPABASE_URL}/rest/v1/${table}`;
    return {
      select(cols = '*') {
        const state = { order: '', eq: [] };
        const api = {
          order(col, { ascending = true } = {}) {
            state.order = `&order=${col}.${ascending ? 'asc' : 'desc'}`;
            return api;
          },
          eq(col, val) {
            state.eq.push(`${col}=eq.${encodeURIComponent(val)}`);
            return api;
          },
          then(onFulfilled, onRejected) {
            const qs = state.eq.length ? '&' + state.eq.join('&') : '';
            const url = `${base}?select=${cols}${qs}${state.order}`;
            return sbFetch(url, { headers: sbHeaders() }).then(onFulfilled, onRejected);
          },
          catch(onRejected) {
            return this.then(undefined, onRejected);
          },
        };
        return api;
      },
      insert(rows) {
        const payload = Array.isArray(rows) ? rows : [rows];
        return sbFetch(base, {
          method: 'POST',
          headers: sbHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify(payload),
        });
      },
      update(patch) {
        return {
          eq(col, val) {
            return sbFetch(`${base}?${col}=eq.${encodeURIComponent(val)}`, {
              method: 'PATCH',
              headers: sbHeaders({ Prefer: 'return=representation' }),
              body: JSON.stringify(patch),
            });
          },
        };
      },
      delete() {
        return {
          eq(col, val) {
            return sbFetch(`${base}?${col}=eq.${encodeURIComponent(val)}`, {
              method: 'DELETE',
              headers: sbHeaders(),
            });
          },
        };
      },
    };
  },
};

const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDecimal = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthLabel = (d) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getNextDueDate(freq, dayOfMonth, dayOfWeek, fromDate) {
  const d = new Date(fromDate);
  if (freq === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (freq === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (freq === 'monthly') {
    d.setMonth(d.getMonth() + 1);
    const lastDay = daysInMonth(d.getFullYear(), d.getMonth());
    d.setDate(Math.min(dayOfMonth || 1, lastDay));
  }
  return d.toISOString().slice(0, 10);
}

function AppInner({ currentUser, onLogout }) {
  const [tab, setTab] = useState('home');
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [showAddTx, setShowAddTx] = useState(false);
  const [showAddBudget, setShowAddBudget] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const viewDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [txRes, catRes, budRes, recRes] = await Promise.all([
        supabase.from('transactions').select('*').eq('user_id', currentUser.id).order('date', { ascending: false }),
        supabase.from('categories').select('*').order('name'),
        supabase.from('budgets').select('*'),
        supabase.from('recurring_transactions').select('*').eq('is_active', true),
      ]);
      if (txRes.error) throw new Error('Transactions: ' + txRes.error.message);
      if (catRes.error) throw new Error('Categories: ' + catRes.error.message);
      if (budRes.error) throw new Error('Budgets: ' + budRes.error.message);
      if (recRes.error) throw new Error('Recurring: ' + recRes.error.message);
      setTransactions(Array.isArray(txRes.data) ? txRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setBudgets(Array.isArray(budRes.data) ? budRes.data : []);
      setRecurring(Array.isArray(recRes.data) ? recRes.data : []);
    } catch (e) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Process due recurring transactions on load
  useEffect(() => {
    if (loading || recurring.length === 0) return;
    const processDue = async () => {
      const today = todayISO();
      const due = recurring.filter(r => r.next_due_date <= today);
      if (due.length === 0) return;
      for (const r of due) {
        let cursor = r.next_due_date;
        let safety = 0;
        const newTxs = [];
        while (cursor <= today && safety < 60) {
          newTxs.push({
            amount: r.amount,
            type: r.type,
            category_id: r.category_id,
            note: r.note ? `${r.note} (auto)` : 'Recurring (auto)',
            date: cursor,
            payment_method: 'bank',
            user_id: currentUser.id,
          });
          cursor = getNextDueDate(r.frequency, r.day_of_month, r.day_of_week, cursor);
          safety++;
        }
        if (newTxs.length > 0) {
          await supabase.from('transactions').insert(newTxs);
          await supabase.from('recurring_transactions').update({ next_due_date: cursor }).eq('id', r.id);
        }
      }
      loadAll();
    };
    processDue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const catMap = useMemo(() => {
    const m = {};
    categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [categories]);

  const monthTx = useMemo(() => {
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    return transactions.filter(t => {
      const d = new Date(t.date);
      return d.getFullYear() === y && d.getMonth() === m;
    });
  }, [transactions, viewDate]);

  const monthIncome = useMemo(() => monthTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [monthTx]);
  const monthExpense = useMemo(() => monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [monthTx]);
  const monthNet = monthIncome - monthExpense;

  // Cash and Bank balances (all-time, not just this month)
  const cashBalance = useMemo(() => {
    return transactions.reduce((s, t) => {
      if (t.payment_method !== 'cash' && t.payment_method !== null && t.payment_method !== undefined) return s;
      const pm = t.payment_method || 'cash';
      if (pm !== 'cash') return s;
      return t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount);
    }, 0);
  }, [transactions]);

  const bankBalance = useMemo(() => {
    return transactions.reduce((s, t) => {
      if ((t.payment_method || 'cash') !== 'bank') return s;
      return t.type === 'income' ? s + Number(t.amount) : s - Number(t.amount);
    }, 0);
  }, [transactions]);

  const isCurrentMonth = monthOffset === 0;
  const dayOfMonthForAvg = isCurrentMonth ? new Date().getDate() : daysInMonth(viewDate.getFullYear(), viewDate.getMonth());
  const avgDailySpend = monthExpense / Math.max(dayOfMonthForAvg, 1);

  // Per-category average daily spend (total month spend ÷ days in month)
  const categoryDailyAvg = useMemo(() => {
    const totalDays = daysInMonth(viewDate.getFullYear(), viewDate.getMonth());
    const map = {};
    monthTx.filter(t => t.type === 'expense').forEach(t => {
      const cat = catMap[t.category_id];
      const key = cat ? cat.id : 'other';
      if (!map[key]) map[key] = {
        name: cat ? cat.name : 'Other',
        icon: cat?.icon || '❓',
        color: cat?.color || '#64748b',
        total: 0,
      };
      map[key].total += Number(t.amount);
    });
    const totalExpense = Object.values(map).reduce((s, c) => s + c.total, 0);
    return Object.values(map).map(c => ({
      ...c,
      dailyAvg: c.total / totalDays,
      pct: totalExpense > 0 ? (c.total / totalExpense) * 100 : 0,
    })).sort((a, b) => b.total - a.total);
  }, [monthTx, catMap, viewDate]);

  // Notification system
  const [notifEnabled, setNotifEnabled] = useState(() => {
    try { return localStorage.getItem('ugp_notif') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    if (!notifEnabled) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const sendNotif = () => {
      try {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification('💸 Udd Gaye Paisa', {
              body: 'Time to log your expenses!',
              icon: '/icon-192.png',
              tag: 'ugp-reminder',
              renotify: true,
            });
          }).catch(e => console.warn('Notif failed:', e));
        }
      } catch (e) {
        console.warn('Notification error:', e.message);
      }
    };

    sendNotif();
    const interval = setInterval(sendNotif, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [notifEnabled]);

  async function toggleNotifications() {
    if (!('Notification' in window)) {
      showToast('Notifications not supported on this browser');
      return;
    }
    if (!notifEnabled) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setNotifEnabled(true);
        try { localStorage.setItem('ugp_notif', 'true'); } catch {}
        showToast('Reminders enabled ✓ (notify on next hour)');
      } else {
        showToast('Permission denied — enable in browser settings');
      }
    } else {
      setNotifEnabled(false);
      try { localStorage.setItem('ugp_notif', 'false'); } catch {}
      showToast('Reminders turned off');
    }
  }

  const categoryBreakdown = useMemo(() => {
    const map = {};
    monthTx.filter(t => t.type === 'expense').forEach(t => {
      const cat = catMap[t.category_id];
      const key = cat ? cat.name : 'Uncategorized';
      if (!map[key]) map[key] = { name: key, value: 0, color: cat ? cat.color : '#64748b', icon: cat ? cat.icon : '❓' };
      map[key].value += Number(t.amount);
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [monthTx, catMap]);

  const budgetProgress = useMemo(() => {
    return budgets.map(b => {
      const cat = catMap[b.category_id];
      const spent = monthTx.filter(t => t.type === 'expense' && t.category_id === b.category_id)
        .reduce((s, t) => s + Number(t.amount), 0);
      return {
        ...b,
        catName: cat ? cat.name : 'Unknown',
        catIcon: cat ? cat.icon : '❓',
        catColor: cat ? cat.color : '#64748b',
        spent,
        pct: Math.min(100, (spent / b.monthly_limit) * 100),
        over: spent > b.monthly_limit,
      };
    }).sort((a, b) => b.pct - a.pct);
  }, [budgets, monthTx, catMap]);

  async function deleteTx(id) {
    await supabase.from('transactions').delete().eq('id', id);
    setTransactions(prev => prev.filter(t => t.id !== id));
    showToast('Transaction deleted');
  }

  async function deleteBudget(id) {
    await supabase.from('budgets').delete().eq('id', id);
    setBudgets(prev => prev.filter(b => b.id !== id));
    showToast('Budget removed');
  }

  async function deleteRecurring(id) {
    await supabase.from('recurring_transactions').update({ is_active: false }).eq('id', id);
    setRecurring(prev => prev.filter(r => r.id !== id));
    showToast('Recurring transaction stopped');
  }

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{GLOBAL_CSS}</style>

      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 90, minHeight: '100vh', position: 'relative' }}>
        <Header notifEnabled={notifEnabled} onToggleNotif={toggleNotifications} currentUser={currentUser} onLogout={onLogout} />

        {error && (
          <div style={{ margin: '12px 20px', padding: '12px 14px', background: '#2a1416', border: '1px solid #5c2329', borderRadius: 12, fontSize: 13, color: '#ff8a8a', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#6b7280' }}>Loading…</div>
        ) : (
          <>
            {tab === 'home' && (
              <HomeTab
                viewDate={viewDate}
                monthOffset={monthOffset}
                setMonthOffset={setMonthOffset}
                monthIncome={monthIncome}
                monthExpense={monthExpense}
                monthNet={monthNet}
                avgDailySpend={avgDailySpend}
                categoryBreakdown={categoryBreakdown}
                monthTx={monthTx}
                catMap={catMap}
                cashBalance={cashBalance}
                bankBalance={bankBalance}
                categoryDailyAvg={categoryDailyAvg}
                onEditTx={(t) => { setEditingTx(t); setShowAddTx(true); }}
                onDeleteTx={deleteTx}
              />
            )}
            {tab === 'daily' && (
              <DailyTab
                viewDate={viewDate}
                monthOffset={monthOffset}
                setMonthOffset={setMonthOffset}
                categoryDailyAvg={categoryDailyAvg}
              />
            )}
            {tab === 'budgets' && (
              <BudgetsTab
                budgetProgress={budgetProgress}
                categories={categories}
                budgets={budgets}
                onAdd={() => setShowAddBudget(true)}
                onDelete={deleteBudget}
              />
            )}
            {tab === 'recurring' && (
              <RecurringTab
                recurring={recurring}
                catMap={catMap}
                onAdd={() => setShowAddRecurring(true)}
                onDelete={deleteRecurring}
              />
            )}
          </>
        )}

        <BottomNav tab={tab} setTab={setTab} onAdd={() => { setEditingTx(null); setShowAddTx(true); }} />

        {showAddTx && (
          <AddTransactionSheet
            categories={categories}
            editingTx={editingTx}
            userId={currentUser.id}
            onClose={() => { setShowAddTx(false); setEditingTx(null); }}
            onSaved={(msg) => { loadAll(); showToast(msg); setShowAddTx(false); setEditingTx(null); }}
          />
        )}
        {showAddBudget && (
          <AddBudgetSheet
            categories={categories.filter(c => c.type === 'expense')}
            existingBudgetCatIds={budgets.map(b => b.category_id)}
            onClose={() => setShowAddBudget(false)}
            onSaved={(msg) => { loadAll(); showToast(msg); setShowAddBudget(false); }}
          />
        )}
        {showAddRecurring && (
          <AddRecurringSheet
            categories={categories}
            onClose={() => setShowAddRecurring(false)}
            onSaved={(msg) => { loadAll(); showToast(msg); setShowAddRecurring(false); }}
          />
        )}

        {toast && (
          <div style={{
            position: 'fixed', bottom: 100, left: '50%', zIndex: 200,
            background: '#1c1f24', border: '1px solid #2d3138', color: '#e8e6e1',
            padding: '10px 18px', borderRadius: 100, fontSize: 13.5, fontWeight: 500,
            animation: 'toastIn 0.25s ease', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            maxWidth: 420, width: 'calc(100% - 48px)', textAlign: 'center',
          }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Design tokens ────────────────────────────────────────────
const T = {
  bg:       '#070810',
  surface:  '#0d0e1a',
  card:     '#111226',
  cardHi:   '#161830',
  border:   '#1e2040',
  border2:  '#2a2d55',
  text:     '#eeeeff',
  muted:    '#7b82b0',
  dim:      '#3d4168',
  indigo:   '#7c6fff',
  indigoL:  '#a89fff',
  indigoGlow: 'rgba(124,111,255,0.18)',
  coral:    '#ff5e7d',
  coralL:   'rgba(255,94,125,0.15)',
  mint:     '#00e5b0',
  mintL:    'rgba(0,229,176,0.15)',
  gold:     '#ffcc44',
  goldD:    '#e0a820',
  goldL:    'rgba(255,204,68,0.15)',
  purple:   '#b06fff',
  blue:     '#4eb5ff',
};

const GLOBAL_CSS = `
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; background: ${T.bg}; }
  ::-webkit-scrollbar { display: none; }
  @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
  @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @keyframes shake   { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
  @keyframes popIn   { 0%{transform:scale(0.88);opacity:0} 100%{transform:scale(1);opacity:1} }
  @keyframes float   { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-6px)} }
  @keyframes glow    { 0%,100%{box-shadow:0 0 20px rgba(124,111,255,0.3)} 50%{box-shadow:0 0 35px rgba(124,111,255,0.5)} }
  .sheet  { animation: slideUp 0.35s cubic-bezier(0.16,1,0.3,1); }
  .overlay{ animation: fadeIn 0.2s ease; }
  .pop    { animation: popIn 0.25s cubic-bezier(0.34,1.56,0.64,1); }
  button  { font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  input, select { font-family: inherit; }
  input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.6); }
  .btn-press:active { transform: scale(0.95); transition: transform 0.1s; }
`;

// ─── Auth Screen ────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState('name'); // 'name' | 'pin' | 'confirmPin'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  function triggerShake(msg) {
    setError(msg);
    setShake(true);
    setTimeout(() => { setShake(false); setPin(''); setConfirmPin(''); }, 700);
  }

  function handleKey(k) {
    const current = step === 'confirmPin' ? confirmPin : pin;
    const setter = step === 'confirmPin' ? setConfirmPin : setPin;
    if (current.length >= 4) return;
    const next = current + k;
    setter(next);
    if (next.length === 4) {
      setTimeout(() => handlePinComplete(next), 100);
    }
  }

  function handleDel() {
    setError('');
    if (step === 'confirmPin') setConfirmPin(p => p.slice(0, -1));
    else setPin(p => p.slice(0, -1));
  }

  async function handlePinComplete(enteredPin) {
    if (mode === 'login') {
      await doLogin(enteredPin);
    } else if (step === 'pin') {
      setStep('confirmPin');
    } else {
      if (enteredPin !== pin) {
        triggerShake('PINs do not match, try again');
        setStep('pin');
        setPin('');
      } else {
        await doSignup(enteredPin);
      }
    }
  }

  async function doLogin(enteredPin) {
    if (!name.trim()) { setStep('name'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await supabase.from('app_users').select('*').eq('name', name.trim());
      if (res.error) throw res.error;
      const users = res.data || [];
      const match = users.find(u => u.pin === enteredPin);
      if (!match) {
        triggerShake('Wrong PIN');
        setLoading(false);
        return;
      }
      onLogin({ id: match.id, name: match.name });
    } catch (e) {
      triggerShake(e.message || 'Login failed');
    }
    setLoading(false);
  }

  async function doSignup(enteredPin) {
    if (!name.trim()) { setStep('name'); return; }
    setLoading(true);
    setError('');
    try {
      // Check if name already exists
      const check = await supabase.from('app_users').select('id').eq('name', name.trim());
      if (check.data && check.data.length > 0) {
        triggerShake('Name already taken, choose another');
        setStep('pin'); setPin(''); setConfirmPin('');
        setLoading(false);
        return;
      }
      const ins = await supabase.from('app_users').insert({ name: name.trim(), pin: enteredPin });
      if (ins.error) throw ins.error;
      // Fetch the new user
      const res = await supabase.from('app_users').select('*').eq('name', name.trim());
      const newUser = res.data?.[0];
      if (!newUser) throw new Error('Signup failed');
      onLogin({ id: newUser.id, name: newUser.name });
    } catch (e) {
      triggerShake(e.message || 'Signup failed');
    }
    setLoading(false);
  }

  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  const currentPin = step === 'confirmPin' ? confirmPin : pin;

  const stepLabel = mode === 'login'
    ? 'Enter your 4-digit PIN'
    : step === 'pin' ? 'Create a 4-digit PIN' : 'Confirm your PIN';

  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(ellipse at 50% 0%, #1a1060 0%, ${T.bg} 60%)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}} @keyframes float{0%,100%{transform:translateY(0px)}50%{transform:translateY(-8px)}}`}</style>

      {/* Logo */}
      <div style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 76, height: 76, borderRadius: 24, background: `linear-gradient(135deg, ${T.gold}, ${T.goldD})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, boxShadow: `0 8px 32px ${T.goldL}`, animation: 'float 3s ease-in-out infinite' }}>💸</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: '-0.03em' }}>Udd Gaye Paisa</div>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>Your money, your way 💰</div>
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', background: T.card, borderRadius: 14, padding: 4, marginBottom: 24, border: `1px solid ${T.border}` }}>
        {['login', 'signup'].map(m => (
          <button key={m} onClick={() => { setMode(m); setStep('name'); setPin(''); setConfirmPin(''); setError(''); }} className="btn-press" style={{ padding: '9px 24px', borderRadius: 11, fontSize: 13, fontWeight: 700, background: mode === m ? `linear-gradient(135deg, ${T.indigo}, ${T.purple})` : 'transparent', color: mode === m ? '#fff' : T.muted, border: 'none', transition: 'all 0.2s' }}>
            {m === 'login' ? 'Login' : 'Sign Up'}
          </button>
        ))}
      </div>

      {/* Name input (shown first) */}
      {step === 'name' ? (
        <div style={{ width: '100%', maxWidth: 280, marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 10, textAlign: 'center', fontWeight: 600 }}>
            {mode === 'login' ? 'Enter your name' : 'Choose a username'}
          </div>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="Your name..."
            autoFocus
            style={{ ...inputStyle, textAlign: 'center', fontSize: 17, fontWeight: 600, marginBottom: 12 }}
          />
          {error && <div style={{ fontSize: 12, color: T.coral, textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>{error}</div>}
          <button onClick={() => { if (!name.trim()) { setError('Please enter your name'); return; } setStep('pin'); }} className="btn-press" style={{ width: '100%', padding: '14px', borderRadius: 16, background: `linear-gradient(135deg, ${T.indigo}, ${T.purple})`, border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, boxShadow: `0 4px 20px ${T.indigo}50` }}>
            Continue →
          </button>
        </div>
      ) : (
        <>
          {/* Greeting */}
          <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 16, textAlign: 'center', fontWeight: 600 }}>
            {mode === 'login' ? `Welcome back, ${name}! 👋` : `Hi ${name}! 👋`}
            <br />
            <span style={{ fontSize: 12, color: T.dim }}>{stepLabel}</span>
          </div>

          {/* PIN dots */}
          <div style={{ display: 'flex', gap: 18, marginBottom: 10, animation: shake ? 'shake 0.4s ease' : 'none' }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width: 18, height: 18, borderRadius: '50%', background: i < currentPin.length ? `linear-gradient(135deg, ${T.indigo}, ${T.purple})` : 'transparent', border: '2px solid ' + (i < currentPin.length ? T.indigo : T.border2), transition: 'all 0.2s cubic-bezier(0.34,1.56,0.64,1)', transform: i < currentPin.length ? 'scale(1.15)' : 'scale(1)', boxShadow: i < currentPin.length ? `0 0 14px ${T.indigoGlow}` : 'none' }} />
            ))}
          </div>

          {error && <div style={{ fontSize: 12, color: T.coral, marginBottom: 8, fontWeight: 600, textAlign: 'center' }}>{error}</div>}
          {!error && <div style={{ height: 20, marginBottom: 8 }} />}

          {loading ? (
            <div style={{ fontSize: 14, color: T.muted, padding: 20, animation: 'pulse 1s infinite' }}>
              {mode === 'login' ? 'Logging in…' : 'Creating account…'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 11, width: '100%', maxWidth: 280 }}>
              {keys.map((k, i) => (
                k === '' ? <div key={i} /> :
                k === '⌫' ? (
                  <button key={i} onClick={handleDel} className="btn-press" style={{ height: 66, borderRadius: 20, background: T.surface, border: `1px solid ${T.border}`, color: T.muted, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⌫</button>
                ) : (
                  <button key={i} onClick={() => handleKey(k)} className="btn-press" style={{ height: 66, borderRadius: 20, background: T.card, border: `1px solid ${T.border}`, color: T.text, fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{k}</button>
                )
              ))}
            </div>
          )}

          <button onClick={() => { setStep('name'); setPin(''); setConfirmPin(''); setError(''); }} style={{ marginTop: 20, fontSize: 12, color: T.dim, background: 'none', border: 'none', cursor: 'pointer' }}>
            ← Change name
          </button>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('ugp_user');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  function handleLogin(user) {
    try { sessionStorage.setItem('ugp_user', JSON.stringify(user)); } catch {}
    setCurrentUser(user);
  }

  function handleLogout() {
    try { sessionStorage.removeItem('ugp_user'); } catch {}
    setCurrentUser(null);
  }

  if (!currentUser) return <AuthScreen onLogin={handleLogin} />;

  return (
    <ErrorBoundary>
      <AppInner currentUser={currentUser} onLogout={handleLogout} />
    </ErrorBoundary>
  );
}

function Header({ notifEnabled, onToggleNotif, currentUser, onLogout }) {
  return (
    <div style={{ padding: '24px 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: 14, background: `linear-gradient(135deg, ${T.gold}, ${T.goldD})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 16px ${T.goldL}`, fontSize: 20 }}>
          💸
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.03em', background: `linear-gradient(90deg, ${T.text}, ${T.indigoL})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.2 }}>Udd Gaye Paisa</div>
          <button onClick={onLogout} style={{ fontSize: 10.5, color: T.indigo, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.mint, display: 'inline-block' }} />
            {currentUser.name} · Lock
          </button>
        </div>
      </div>
      <button onClick={onToggleNotif} className="btn-press" style={{
        width: 40, height: 40, borderRadius: 13,
        border: `1px solid ${notifEnabled ? T.gold + '50' : T.border}`,
        background: notifEnabled ? T.goldL : T.card,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: notifEnabled ? T.gold : T.dim,
        boxShadow: notifEnabled ? `0 0 16px ${T.goldL}` : 'none',
      }}>
        {notifEnabled ? <Bell size={16} /> : <BellOff size={16} />}
      </button>
    </div>
  );
}

function MonthSwitcher({ viewDate, monthOffset, setMonthOffset }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 16px' }}>
      <button onClick={() => setMonthOffset(o => o - 1)} style={{ width: 32, height: 32, borderRadius: 10, background: T.card, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.muted }}>
        <ChevronLeft size={16} />
      </button>
      <span style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>{monthLabel(viewDate)}</span>
      <button onClick={() => setMonthOffset(o => Math.min(0, o + 1))} disabled={monthOffset === 0} style={{ width: 32, height: 32, borderRadius: 10, background: T.card, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: monthOffset === 0 ? T.border : T.muted }}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function HomeTab({ viewDate, monthOffset, setMonthOffset, monthIncome, monthExpense, monthNet, avgDailySpend, categoryBreakdown, monthTx, catMap, cashBalance, bankBalance, onEditTx, onDeleteTx, categoryDailyAvg }) {
  const [modal, setModal] = useState(null); // 'income' | 'expense' | 'daily' | null

  const expenseTx = monthTx.filter(t => t.type === 'expense');
  const incomeTx = monthTx.filter(t => t.type === 'income');
  const totalDays = daysInMonth(viewDate.getFullYear(), viewDate.getMonth());

  return (
    <div>
      <MonthSwitcher viewDate={viewDate} monthOffset={monthOffset} setMonthOffset={setMonthOffset} />

      {/* Hero net balance card */}
      <div style={{ margin: '0 20px 14px', padding: '26px 22px 22px', borderRadius: 28, background: `linear-gradient(145deg, #1a1060 0%, #0e0a2a 50%, #0a1230 100%)`, border: `1px solid ${T.border2}`, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -20, width: 160, height: 160, borderRadius: '50%', background: `radial-gradient(circle, ${T.indigo}30, transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -30, left: -20, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, ${T.purple}20, transparent 70%)`, pointerEvents: 'none' }} />
        <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Net Balance · {viewDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</div>
        <div style={{ fontSize: 42, fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, marginBottom: 20, background: monthNet >= 0 ? `linear-gradient(135deg, ${T.text}, ${T.indigoL})` : `linear-gradient(135deg, ${T.coral}, #ff9eb5)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          {monthNet >= 0 ? fmt(monthNet) : '−' + fmt(Math.abs(monthNet))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setModal('income')} className="btn-press" style={{ flex: 1, padding: '12px', borderRadius: 16, background: `${T.mint}12`, border: `1px solid ${T.mint}30`, textAlign: 'left' }}>
            <div style={{ fontSize: 10, color: T.mint, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>↑ INCOME</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: T.mint, letterSpacing: '-0.02em' }}>{fmt(monthIncome)}</div>
            <div style={{ fontSize: 9.5, color: T.mint, opacity: 0.6, marginTop: 3 }}>Tap to view →</div>
          </button>
          <button onClick={() => setModal('expense')} className="btn-press" style={{ flex: 1, padding: '12px', borderRadius: 16, background: `${T.coral}12`, border: `1px solid ${T.coral}30`, textAlign: 'left' }}>
            <div style={{ fontSize: 10, color: T.coral, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>↓ EXPENSE</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: T.coral, letterSpacing: '-0.02em' }}>{fmt(monthExpense)}</div>
            <div style={{ fontSize: 9.5, color: T.coral, opacity: 0.6, marginTop: 3 }}>Tap to view →</div>
          </button>
        </div>
      </div>

      {/* Cash & Bank balance cards */}
      <div style={{ display: 'flex', gap: 10, margin: '0 20px 14px' }}>
        <div style={{ flex: 1, padding: '16px', borderRadius: 20, background: `linear-gradient(145deg, #0d1a35, #0a1225)`, border: `1px solid ${T.indigo}30`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -15, right: -15, width: 60, height: 60, borderRadius: '50%', background: `${T.indigo}15`, pointerEvents: 'none' }} />
          <div style={{ fontSize: 20, marginBottom: 6 }}>🏦</div>
          <div style={{ fontSize: 10.5, color: T.muted, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>BANK</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: bankBalance >= 0 ? T.blue : T.coral, letterSpacing: '-0.02em' }}>
            {bankBalance >= 0 ? fmt(bankBalance) : '−' + fmt(Math.abs(bankBalance))}
          </div>
        </div>
        <div style={{ flex: 1, padding: '16px', borderRadius: 20, background: `linear-gradient(145deg, #0d2a1a, #0a1a12)`, border: `1px solid ${T.mint}25`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -15, right: -15, width: 60, height: 60, borderRadius: '50%', background: `${T.mint}12`, pointerEvents: 'none' }} />
          <div style={{ fontSize: 20, marginBottom: 6 }}>💵</div>
          <div style={{ fontSize: 10.5, color: T.muted, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>CASH</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: cashBalance >= 0 ? T.mint : T.coral, letterSpacing: '-0.02em' }}>
            {cashBalance >= 0 ? fmt(cashBalance) : '−' + fmt(Math.abs(cashBalance))}
          </div>
        </div>
      </div>

      {/* Tappable Avg daily spend */}
      <button onClick={() => setModal('daily')} className="btn-press" style={{ margin: '0 20px 14px', padding: '14px 18px', borderRadius: 18, background: `linear-gradient(135deg, #1a1508, #120f04)`, border: `1px solid ${T.gold}25`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 'calc(100% - 40px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: T.goldL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Calendar size={15} color={T.gold} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, letterSpacing: '0.06em' }}>AVG DAILY SPEND</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.gold, letterSpacing: '-0.02em' }}>{fmtDecimal(avgDailySpend)}</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: T.muted, background: T.goldL, padding: '4px 9px', borderRadius: 100, fontWeight: 600 }}>By category →</div>
      </button>

      {/* Category pie breakdown */}
      {categoryBreakdown.length > 0 && (
        <div style={{ margin: '0 20px 20px' }}>
          <SectionTitle>Where it went</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px', borderRadius: 20, background: T.card, border: `1px solid ${T.border}` }}>
            <div style={{ width: 96, height: 96, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryBreakdown} dataKey="value" innerRadius={30} outerRadius={46} paddingAngle={3} strokeWidth={0}>
                    {categoryBreakdown.map((c, i) => <Cell key={i} fill={c.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              {categoryBreakdown.slice(0, 5).map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                  <span style={{ color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{c.name}</span>
                  <span style={{ color: T.muted, fontWeight: 700, flexShrink: 0 }}>{fmt(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {modal === 'income' && (
        <TxModal
          title="Income"
          total={fmt(monthIncome)}
          totalColor={T.mint}
          transactions={incomeTx}
          catMap={catMap}
          type="income"
          onEdit={(t) => { setModal(null); onEditTx(t); }}
          onDelete={onDeleteTx}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'expense' && (
        <TxModal
          title="Expenses"
          total={fmt(monthExpense)}
          totalColor={T.coral}
          transactions={expenseTx}
          catMap={catMap}
          type="expense"
          onEdit={(t) => { setModal(null); onEditTx(t); }}
          onDelete={onDeleteTx}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'daily' && (
        <DailyModal
          categoryDailyAvg={categoryDailyAvg}
          totalDays={totalDays}
          avgDailySpend={avgDailySpend}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function TxModal({ title, total, totalColor, transactions, catMap, type, onEdit, onDelete, onClose }) {
  const isIncome = type === 'income';
  return (
    <div className="overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet" style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: `linear-gradient(180deg, #0f1128, ${T.surface})`, borderRadius: '28px 28px 0 0', border: `1px solid ${T.border2}`, borderBottom: 'none', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border2, margin: '14px auto 0' }} />
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: T.text, letterSpacing: '-0.03em' }}>{title}</div>
            <div style={{ fontSize: 13, color: totalColor, fontWeight: 700, marginTop: 2 }}>
              {isIncome ? '+' : '−'}{total} · {transactions.length} transactions
            </div>
          </div>
          <button onClick={onClose} className="btn-press" style={{ width: 34, height: 34, borderRadius: '50%', background: T.card, border: `1px solid ${T.border}`, color: T.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} />
          </button>
        </div>
        {/* List */}
        <div style={{ overflowY: 'auto', padding: '0 16px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {transactions.length === 0 ? (
            <EmptyState icon={isIncome ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />} text={`No ${title.toLowerCase()} this month.`} />
          ) : transactions.map(t => (
            <TxCard key={t.id} t={t} cat={catMap[t.category_id]} type={type} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DailyModal({ categoryDailyAvg, totalDays, avgDailySpend, onClose }) {
  return (
    <div className="overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet" style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: `linear-gradient(180deg, #0f1128, ${T.surface})`, borderRadius: '28px 28px 0 0', border: `1px solid ${T.border2}`, borderBottom: 'none', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border2, margin: '14px auto 0' }} />
        <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: T.text, letterSpacing: '-0.03em' }}>Daily Average</div>
            <div style={{ fontSize: 13, color: T.gold, fontWeight: 700, marginTop: 2 }}>{fmtDecimal(avgDailySpend)}/day · {totalDays} days this month</div>
          </div>
          <button onClick={onClose} className="btn-press" style={{ width: 34, height: 34, borderRadius: '50%', background: T.card, border: `1px solid ${T.border}`, color: T.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 16px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {categoryDailyAvg.length === 0 ? (
            <EmptyState icon={<BarChart2 size={22} />} text="No expenses to show." />
          ) : categoryDailyAvg.map((c, i) => (
            <div key={i} style={{ padding: '14px', borderRadius: 18, background: T.card, border: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: c.color + '25', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{c.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>₹{c.total.toLocaleString('en-IN')} total this month</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: c.color }}>{fmtDecimal(c.dailyAvg)}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>per day</div>
                </div>
              </div>
              <div style={{ height: 5, borderRadius: 100, background: T.border, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${c.pct}%`, background: `linear-gradient(90deg, ${c.color}, ${c.color}88)`, borderRadius: 100 }} />
              </div>
              <div style={{ fontSize: 10.5, color: T.dim, marginTop: 5, textAlign: 'right' }}>{Math.round(c.pct)}% of total</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Reusable transaction card
function TxCard({ t, cat, type, onEdit, onDelete }) {
  const isBank = (t.payment_method || 'bank') === 'bank';
  const isIncome = type === 'income';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 13px', borderRadius: 16, background: isIncome ? T.mintL : T.card, border: `1px solid ${isIncome ? T.mint + '30' : T.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: cat?.color || (isIncome ? T.mint : T.coral), borderRadius: '0 2px 2px 0' }} />
      <div style={{ width: 38, height: 38, borderRadius: 12, background: (cat?.color || (isIncome ? T.mint : T.coral)) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
        {cat?.icon || (isIncome ? '💰' : '❓')}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cat?.name || 'Uncategorized'}
        </div>
        <div style={{ fontSize: 10.5, color: T.muted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {t.note && <span>{t.note} ·</span>}
          <span>{new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          <span style={{ background: isBank ? T.indigoGlow : T.mintL, color: isBank ? T.indigoL : T.mint, borderRadius: 5, padding: '1px 5px', fontWeight: 700, fontSize: 9.5 }}>
            {isBank ? '🏦' : '💵'}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: isIncome ? T.mint : T.coral, flexShrink: 0 }}>
        {isIncome ? '+' : '−'}{fmt(t.amount)}
      </div>
      <button onClick={() => onEdit(t)} className="btn-press" style={{ width: 28, height: 28, borderRadius: 9, background: T.surface, border: `1px solid ${T.border}`, color: T.dim, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Edit2 size={11} />
      </button>
      <button onClick={() => onDelete(t.id)} className="btn-press" style={{ width: 28, height: 28, borderRadius: 9, background: T.surface, border: `1px solid ${T.border}`, color: T.dim, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function DailyTab({ viewDate, monthOffset, setMonthOffset, categoryDailyAvg }) {
  const totalDays = daysInMonth(viewDate.getFullYear(), viewDate.getMonth());
  const isCurrentMonth = monthOffset === 0;
  const daysElapsed = isCurrentMonth ? new Date().getDate() : totalDays;
  const totalDailyAvg = categoryDailyAvg.reduce((s, c) => s + c.dailyAvg, 0);

  return (
    <div>
      <MonthSwitcher viewDate={viewDate} monthOffset={monthOffset} setMonthOffset={setMonthOffset} />
      <div style={{ padding: '0 20px' }}>

        {/* Summary card */}
        <div style={{ padding: '16px', borderRadius: 16, background: '#13151a', border: '1px solid #1d2026', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            Avg total daily spend · {totalDays} days in month
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {fmtDecimal(totalDailyAvg)}
            <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 400 }}>/day</span>
          </div>
          {isCurrentMonth && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
              Based on {daysElapsed} days elapsed this month
            </div>
          )}
        </div>

        <SectionTitle>Per category · daily average</SectionTitle>

        {categoryDailyAvg.length === 0 ? (
          <EmptyState icon={<BarChart2 size={26} />} text="No expenses this month. Add transactions to see your daily average per category." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {categoryDailyAvg.map((c, i) => (
              <div key={i} style={{ padding: '14px 16px', borderRadius: 16, background: '#13151a', border: '1px solid #1d2026' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: c.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                    {c.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: '#6b7280' }}>₹{c.total.toLocaleString('en-IN')} total this month</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: c.color }}>{fmtDecimal(c.dailyAvg)}</div>
                    <div style={{ fontSize: 10.5, color: '#6b7280' }}>per day</div>
                  </div>
                </div>
                {/* Progress bar showing % of total spend */}
                <div style={{ height: 5, borderRadius: 100, background: '#1d2026', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${c.pct}%`, background: c.color, borderRadius: 100 }} />
                </div>
                <div style={{ fontSize: 11, color: '#4b5058', marginTop: 4, textAlign: 'right' }}>
                  {Math.round(c.pct)}% of total expenses
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BudgetsTab({ budgetProgress, onAdd, onDelete }) {
  return (
    <div style={{ padding: '20px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Budgets</h2>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: '#0b0d10', background: '#f0b429', border: 'none', borderRadius: 100, padding: '8px 13px' }}>
          <Plus size={14} /> Budget
        </button>
      </div>

      {budgetProgress.length === 0 ? (
        <EmptyState icon={<Target size={26} />} text="No budgets set. Add one to track spending limits per category." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {budgetProgress.map(b => (
            <div key={b.id} style={{ padding: '14px 16px', borderRadius: 16, background: '#13151a', border: '1px solid #1d2026' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{b.catIcon}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{b.catName}</span>
                </div>
                <button onClick={() => onDelete(b.id)} style={{ background: 'transparent', border: 'none', color: '#4b5058' }}>
                  <Trash2 size={13} />
                </button>
              </div>
              <div style={{ height: 7, borderRadius: 100, background: '#1d2026', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: `${b.pct}%`, borderRadius: 100, background: b.over ? '#f87171' : b.catColor, transition: 'width 0.3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: b.over ? '#f87171' : '#9ca3af', fontWeight: 600 }}>{fmt(b.spent)} spent</span>
                <span style={{ color: '#6b7280' }}>of {fmt(b.monthly_limit)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecurringTab({ recurring, catMap, onAdd, onDelete }) {
  const freqLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
  return (
    <div style={{ padding: '20px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Recurring</h2>
        <button onClick={onAdd} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: '#0b0d10', background: '#f0b429', border: 'none', borderRadius: 100, padding: '8px 13px' }}>
          <Plus size={14} /> Recurring
        </button>
      </div>

      {recurring.length === 0 ? (
        <EmptyState icon={<Repeat size={26} />} text="No recurring transactions. Add rent, subscriptions, or salary to automate entries." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recurring.map(r => {
            const cat = catMap[r.category_id];
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: '#13151a', border: '1px solid #1d2026' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: (cat?.color || '#64748b') + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
                  {cat?.icon || '❓'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat?.name || 'Uncategorized'}</div>
                  <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 1 }}>
                    {freqLabel[r.frequency]} · next {new Date(r.next_due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: r.type === 'income' ? '#4ade80' : '#e8e6e1', flexShrink: 0 }}>
                  {r.type === 'income' ? '+' : '−'}{fmt(r.amount)}
                </div>
                <button onClick={() => onDelete(r.id)} style={{ width: 28, height: 28, borderRadius: 8, background: 'transparent', border: 'none', color: '#4b5058', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children, color }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, color: color || T.muted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 3, height: 13, borderRadius: 2, background: `linear-gradient(180deg, ${color || T.indigo}, ${color || T.purple})` }} />
      {children}
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', borderRadius: 20, background: T.card, border: `1px dashed ${T.border2}` }}>
      <div style={{ color: T.dim, marginBottom: 12, display: 'flex', justifyContent: 'center', opacity: 0.6 }}>{icon}</div>
      <div style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

function BottomNav({ tab, setTab, onAdd }) {
  const items = [
    { id: 'home', label: 'Home', icon: Wallet },
    { id: 'daily', label: 'Daily', icon: BarChart2 },
    { id: 'budgets', label: 'Budget', icon: Target },
    { id: 'recurring', label: 'Auto', icon: Repeat },
  ];
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px 28px' }}>
        <div style={{ background: `rgba(13,14,26,0.92)`, backdropFilter: 'blur(24px)', border: `1px solid ${T.border2}`, borderRadius: 100, padding: '7px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: `0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px ${T.border}` }}>
          {items.slice(0, 2).map(item => <NavBtn key={item.id} item={item} active={tab === item.id} onClick={() => setTab(item.id)} />)}
          <button onClick={onAdd} className="btn-press" style={{ width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg, ${T.indigo}, ${T.purple})`, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 20px ${T.indigo}60, 0 0 0 4px ${T.indigoGlow}`, flexShrink: 0 }}>
            <Plus size={24} color="#fff" strokeWidth={2.5} />
          </button>
          {items.slice(2).map(item => <NavBtn key={item.id} item={item} active={tab === item.id} onClick={() => setTab(item.id)} />)}
        </div>
      </div>
    </div>
  );
}

function NavBtn({ item, active, onClick }) {
  const Icon = item.icon;
  return (
    <button onClick={onClick} className="btn-press" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: active ? T.indigoGlow : 'transparent', border: 'none', color: active ? T.indigoL : T.dim, padding: '7px 14px', flex: 1, borderRadius: 100, transition: 'all 0.2s' }}>
      <Icon size={19} strokeWidth={active ? 2.5 : 1.8} />
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em' }}>{item.label}</span>
    </button>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet" style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: `linear-gradient(180deg, #0f1128, ${T.surface})`, borderRadius: '28px 28px 0 0', border: `1px solid ${T.border2}`, borderBottom: 'none', maxHeight: '92vh', overflowY: 'auto', padding: '22px 20px 36px' }} onClick={e => e.stopPropagation()}>
        {/* Handle bar */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border2, margin: '0 auto 18px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <h3 style={{ fontSize: 20, fontWeight: 900, margin: 0, letterSpacing: '-0.03em', color: T.text }}>{title}</h3>
          <button onClick={onClose} className="btn-press" style={{ width: 34, height: 34, borderRadius: '50%', background: T.card, border: `1px solid ${T.border}`, color: T.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '14px 16px', borderRadius: 16, background: T.card,
  border: `1px solid ${T.border2}`, color: T.text, fontSize: 15, outline: 'none',
  transition: 'border-color 0.2s',
};
const labelStyle = { fontSize: 11, fontWeight: 800, color: T.muted, marginBottom: 10, display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em' };

function AddTransactionSheet({ categories, editingTx, userId, onClose, onSaved }) {
  const [type, setType] = useState(editingTx?.type || 'expense');
  const [amount, setAmount] = useState(editingTx?.amount?.toString() || '');
  const [categoryId, setCategoryId] = useState(editingTx?.category_id || '');
  const [note, setNote] = useState(editingTx?.note || '');
  const [date, setDate] = useState(editingTx?.date || todayISO());
  const [paymentMethod, setPaymentMethod] = useState(editingTx?.payment_method || 'bank');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const filteredCats = categories.filter(c => c.type === type);

  useEffect(() => {
    if (!editingTx) {
      setCategoryId(filteredCats[0]?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function handleSave() {
    if (!amount || Number(amount) <= 0) { setErr('Enter a valid amount'); return; }
    if (!categoryId) { setErr('Select a category'); return; }
    setSaving(true);
    setErr('');
    try {
      if (editingTx) {
        const { error } = await supabase.from('transactions').update({
          amount: Number(amount), type, category_id: categoryId, note: note || null, date, payment_method: paymentMethod,
        }).eq('id', editingTx.id);
        if (error) throw error;
        onSaved('Transaction updated');
      } else {
        const { error } = await supabase.from('transactions').insert({
          amount: Number(amount), type, category_id: categoryId, note: note || null, date, payment_method: paymentMethod, user_id: userId,
        });
        if (error) throw error;
        onSaved('Transaction added');
      }
    } catch (e) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={editingTx ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['expense', 'income'].map(t => (
          <button key={t} onClick={() => setType(t)} style={{
            flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 13, fontWeight: 600,
            border: '1px solid ' + (type === t ? (t === 'income' ? '#22c55e' : '#f0b429') : '#23262c'),
            background: type === t ? (t === 'income' ? 'rgba(34,197,94,0.12)' : 'rgba(240,180,41,0.12)') : '#1a1d23',
            color: type === t ? (t === 'income' ? '#4ade80' : '#f0b429') : '#8b9099',
          }}>
            {t === 'income' ? 'Income' : 'Expense'}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Payment method</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ id: 'cash', label: '💵 Cash' }, { id: 'bank', label: '🏦 Bank' }].map(m => (
            <button key={m.id} onClick={() => setPaymentMethod(m.id)} style={{
              flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 13, fontWeight: 600,
              border: '1px solid ' + (paymentMethod === m.id ? '#f0b429' : '#23262c'),
              background: paymentMethod === m.id ? 'rgba(240,180,41,0.12)' : '#1a1d23',
              color: paymentMethod === m.id ? '#f0b429' : '#8b9099',
            }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Amount</label>
        <input style={inputStyle} type="number" inputMode="decimal" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Category</label>
        {filteredCats.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#f87171', padding: '10px 0' }}>
            No {type} categories found (loaded {categories.length} total).
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {filteredCats.map(c => (
              <button key={c.id} onClick={() => setCategoryId(c.id)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 100,
                border: '1px solid ' + (categoryId === c.id ? c.color : '#23262c'),
                background: categoryId === c.id ? c.color + '22' : '#1a1d23',
                color: categoryId === c.id ? '#e8e6e1' : '#9ca3af', fontSize: 12.5, fontWeight: 500,
              }}>
                <span>{c.icon}</span>{c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Date</label>
        <input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} max={todayISO()} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Note (optional)</label>
        <input style={inputStyle} type="text" placeholder="e.g. Lunch with friends" value={note} onChange={e => setNote(e.target.value)} />
      </div>

      {err && <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <button onClick={handleSave} disabled={saving} style={{
        width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', fontSize: 14.5, fontWeight: 700,
        background: '#f0b429', color: '#0b0d10', opacity: saving ? 0.6 : 1,
      }}>
        {saving ? 'Saving…' : editingTx ? 'Save changes' : 'Add transaction'}
      </button>
    </Sheet>
  );
}

function AddBudgetSheet({ categories, existingBudgetCatIds, onClose, onSaved }) {
  const available = categories.filter(c => !existingBudgetCatIds.includes(c.id));
  const [categoryId, setCategoryId] = useState(available[0]?.id || '');
  const [limit, setLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    if (!categoryId) { setErr('Select a category'); return; }
    if (!limit || Number(limit) <= 0) { setErr('Enter a valid limit'); return; }
    setSaving(true);
    setErr('');
    try {
      const { error } = await supabase.from('budgets').insert({ category_id: categoryId, monthly_limit: Number(limit) });
      if (error) throw error;
      onSaved('Budget added');
    } catch (e) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (available.length === 0) {
    return (
      <Sheet title="Add budget" onClose={onClose}>
        <EmptyState icon={<Target size={24} />} text="All expense categories already have a budget set." />
      </Sheet>
    );
  }

  return (
    <Sheet title="Add budget" onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Category</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {available.map(c => (
            <button key={c.id} onClick={() => setCategoryId(c.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 100,
              border: '1px solid ' + (categoryId === c.id ? c.color : '#23262c'),
              background: categoryId === c.id ? c.color + '22' : '#1a1d23',
              color: categoryId === c.id ? '#e8e6e1' : '#9ca3af', fontSize: 12.5, fontWeight: 500,
            }}>
              <span>{c.icon}</span>{c.name}
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Monthly limit</label>
        <input style={inputStyle} type="number" inputMode="decimal" placeholder="0" value={limit} onChange={e => setLimit(e.target.value)} />
      </div>
      {err && <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={{
        width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', fontSize: 14.5, fontWeight: 700,
        background: '#f0b429', color: '#0b0d10', opacity: saving ? 0.6 : 1,
      }}>
        {saving ? 'Saving…' : 'Add budget'}
      </button>
    </Sheet>
  );
}

function AddRecurringSheet({ categories, onClose, onSaved }) {
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [startDate, setStartDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const filteredCats = categories.filter(c => c.type === type);

  useEffect(() => { setCategoryId(filteredCats[0]?.id || ''); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!amount || Number(amount) <= 0) { setErr('Enter a valid amount'); return; }
    if (!categoryId) { setErr('Select a category'); return; }
    setSaving(true);
    setErr('');
    try {
      const dow = new Date(startDate).getDay();
      const { error } = await supabase.from('recurring_transactions').insert({
        amount: Number(amount), type, category_id: categoryId, note: note || null,
        frequency, day_of_month: frequency === 'monthly' ? Number(dayOfMonth) : null,
        day_of_week: frequency === 'weekly' ? dow : null,
        next_due_date: startDate, is_active: true,
      });
      if (error) throw error;
      onSaved('Recurring transaction added');
    } catch (e) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Add recurring" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['expense', 'income'].map(t => (
          <button key={t} onClick={() => setType(t)} style={{
            flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 13, fontWeight: 600,
            border: '1px solid ' + (type === t ? (t === 'income' ? '#22c55e' : '#f0b429') : '#23262c'),
            background: type === t ? (t === 'income' ? 'rgba(34,197,94,0.12)' : 'rgba(240,180,41,0.12)') : '#1a1d23',
            color: type === t ? (t === 'income' ? '#4ade80' : '#f0b429') : '#8b9099',
          }}>
            {t === 'income' ? 'Income' : 'Expense'}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Amount</label>
        <input style={inputStyle} type="number" inputMode="decimal" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Category</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {filteredCats.map(c => (
            <button key={c.id} onClick={() => setCategoryId(c.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 100,
              border: '1px solid ' + (categoryId === c.id ? c.color : '#23262c'),
              background: categoryId === c.id ? c.color + '22' : '#1a1d23',
              color: categoryId === c.id ? '#e8e6e1' : '#9ca3af', fontSize: 12.5, fontWeight: 500,
            }}>
              <span>{c.icon}</span>{c.name}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Frequency</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {['daily', 'weekly', 'monthly'].map(f => (
            <button key={f} onClick={() => setFrequency(f)} style={{
              flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12.5, fontWeight: 600, textTransform: 'capitalize',
              border: '1px solid ' + (frequency === f ? '#f0b429' : '#23262c'),
              background: frequency === f ? 'rgba(240,180,41,0.12)' : '#1a1d23',
              color: frequency === f ? '#f0b429' : '#8b9099',
            }}>{f}</button>
          ))}
        </div>
      </div>

      {frequency === 'monthly' && (
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Day of month</label>
          <input style={inputStyle} type="number" min="1" max="31" value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)} />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Starting from</label>
        <input style={inputStyle} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Note (optional)</label>
        <input style={inputStyle} type="text" placeholder="e.g. Netflix subscription" value={note} onChange={e => setNote(e.target.value)} />
      </div>

      {err && <div style={{ color: '#f87171', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <button onClick={handleSave} disabled={saving} style={{
        width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', fontSize: 14.5, fontWeight: 700,
        background: '#f0b429', color: '#0b0d10', opacity: saving ? 0.6 : 1,
      }}>
        {saving ? 'Saving…' : 'Add recurring'}
      </button>
    </Sheet>
  );
}
