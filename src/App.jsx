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

function AppInner() {
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
        supabase.from('transactions').select('*').order('date', { ascending: false }),
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
      if (!Array.isArray(catRes.data) || catRes.data.length === 0) {
        console.warn('Categories loaded empty:', catRes);
      }
    } catch (e) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const isCurrentMonth = monthOffset === 0;
  const dayOfMonthForAvg = isCurrentMonth ? new Date().getDate() : daysInMonth(viewDate.getFullYear(), viewDate.getMonth());
  const avgDailySpend = monthExpense / Math.max(dayOfMonthForAvg, 1);

  // Daily breakdown: group transactions by date, then by category
  const dailyBreakdown = useMemo(() => {
    const map = {};
    monthTx.forEach(t => {
      if (!map[t.date]) map[t.date] = { date: t.date, total: 0, income: 0, expense: 0, cats: {} };
      const d = map[t.date];
      if (t.type === 'expense') {
        d.expense += Number(t.amount);
        d.total += Number(t.amount);
        const cat = catMap[t.category_id];
        const key = cat ? cat.name : 'Other';
        if (!d.cats[key]) d.cats[key] = { name: key, icon: cat?.icon || '❓', color: cat?.color || '#64748b', amount: 0 };
        d.cats[key].amount += Number(t.amount);
      } else {
        d.income += Number(t.amount);
      }
    });
    return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
  }, [monthTx, catMap]);

  // Notification system
  const [notifEnabled, setNotifEnabled] = useState(() => localStorage.getItem('ugp_notif') === 'true');

  useEffect(() => {
    if (!notifEnabled) return;
    if (!('Notification' in window)) return;

    const sendNotif = () => {
      if (Notification.permission === 'granted') {
        new Notification('💸 Udd Gaye Paisa', {
          body: 'Time to log your expenses! Tap to open.',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'ugp-reminder',
        });
      }
    };

    // Fire immediately if enabled, then every hour
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
        localStorage.setItem('ugp_notif', 'true');
        showToast('Hourly reminders enabled ✓');
      } else {
        showToast('Permission denied — enable in browser settings');
      }
    } else {
      setNotifEnabled(false);
      localStorage.setItem('ugp_notif', 'false');
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
    <div style={{ minHeight: '100vh', background: '#0b0d10', color: '#e8e6e1', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { display: none; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
        .sheet { animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .overlay { animation: fadeIn 0.2s ease; }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
      `}</style>

      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 90, minHeight: '100vh', position: 'relative' }}>
        <Header notifEnabled={notifEnabled} onToggleNotif={toggleNotifications} />

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
                onEditTx={(t) => { setEditingTx(t); setShowAddTx(true); }}
                onDeleteTx={deleteTx}
              />
            )}
            {tab === 'daily' && (
              <DailyTab
                viewDate={viewDate}
                monthOffset={monthOffset}
                setMonthOffset={setMonthOffset}
                dailyBreakdown={dailyBreakdown}
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function Header({ notifEnabled, onToggleNotif }) {
  return (
    <div style={{ padding: '28px 20px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, #f0b429, #de9a1f)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 15 }}>💸</span>
        </div>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>Udd Gaye Paisa</span>
      </div>
      <button onClick={onToggleNotif} style={{
        width: 36, height: 36, borderRadius: 11, border: '1px solid ' + (notifEnabled ? '#f0b429' : '#23262c'),
        background: notifEnabled ? 'rgba(240,180,41,0.12)' : '#13151a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: notifEnabled ? '#f0b429' : '#5b6068',
      }}>
        {notifEnabled ? <Bell size={16} /> : <BellOff size={16} />}
      </button>
    </div>
  );
}

function MonthSwitcher({ viewDate, monthOffset, setMonthOffset }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 18px' }}>
      <button onClick={() => setMonthOffset(o => o - 1)} style={{ width: 34, height: 34, borderRadius: 10, background: '#171a1f', border: '1px solid #23262c', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
        <ChevronLeft size={17} />
      </button>
      <span style={{ fontSize: 14.5, fontWeight: 600, color: '#c9cdd3' }}>{monthLabel(viewDate)}</span>
      <button onClick={() => setMonthOffset(o => Math.min(0, o + 1))} disabled={monthOffset === 0} style={{ width: 34, height: 34, borderRadius: 10, background: '#171a1f', border: '1px solid #23262c', display: 'flex', alignItems: 'center', justifyContent: 'center', color: monthOffset === 0 ? '#3a3d44' : '#9ca3af' }}>
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

function HomeTab({ viewDate, monthOffset, setMonthOffset, monthIncome, monthExpense, monthNet, avgDailySpend, categoryBreakdown, monthTx, catMap, onEditTx, onDeleteTx }) {
  return (
    <div>
      <MonthSwitcher viewDate={viewDate} monthOffset={monthOffset} setMonthOffset={setMonthOffset} />

      {/* Net balance hero */}
      <div style={{ margin: '0 20px 16px', padding: '24px 22px', borderRadius: 20, background: 'linear-gradient(155deg, #16191e, #121419)', border: '1px solid #21242a' }}>
        <div style={{ fontSize: 12.5, color: '#8b9099', fontWeight: 500, marginBottom: 6 }}>Net this month</div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', color: monthNet >= 0 ? '#e8e6e1' : '#ff8a8a' }}>
          {monthNet >= 0 ? fmt(monthNet) : '−' + fmt(Math.abs(monthNet))}
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: 7, background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowUpRight size={12} color="#4ade80" />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: '#6b7280' }}>Income</div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{fmt(monthIncome)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: 7, background: 'rgba(248,113,113,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowDownRight size={12} color="#f87171" />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: '#6b7280' }}>Expense</div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{fmt(monthExpense)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Avg daily spend */}
      <div style={{ margin: '0 20px 20px', padding: '14px 16px', borderRadius: 16, background: '#13151a', border: '1px solid #1d2026', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Calendar size={15} color="#f0b429" />
          <span style={{ fontSize: 13, color: '#9ca3af' }}>Avg daily spend</span>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>{fmtDecimal(avgDailySpend)}</span>
      </div>

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <div style={{ margin: '0 20px 20px' }}>
          <SectionTitle>Where it went</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 16, background: '#13151a', border: '1px solid #1d2026' }}>
            <div style={{ width: 92, height: 92, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryBreakdown} dataKey="value" innerRadius={28} outerRadius={44} paddingAngle={2} strokeWidth={0}>
                    {categoryBreakdown.map((c, i) => <Cell key={i} fill={c.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
              {categoryBreakdown.slice(0, 5).map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                  <span style={{ color: '#c9cdd3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span style={{ color: '#8b9099', fontWeight: 600, flexShrink: 0 }}>{fmt(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Daily breakdown */}
      <div style={{ margin: '0 20px' }}>
        <SectionTitle>Daily breakdown</SectionTitle>
        {monthTx.length === 0 ? (
          <EmptyState icon={<Wallet size={26} />} text="No transactions yet this month. Tap + to add one." />
        ) : (
          <DailyBreakdown monthTx={monthTx} catMap={catMap} onEditTx={onEditTx} onDeleteTx={onDeleteTx} />
        )}
      </div>
    </div>
  );
}

function DailyTab({ viewDate, monthOffset, setMonthOffset, dailyBreakdown }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div>
      <MonthSwitcher viewDate={viewDate} monthOffset={monthOffset} setMonthOffset={setMonthOffset} />
      <div style={{ padding: '0 20px' }}>
        <SectionTitle>Day-wise expenses</SectionTitle>
        {dailyBreakdown.length === 0 ? (
          <EmptyState icon={<BarChart2 size={26} />} text="No expenses this month yet. Add transactions to see your daily breakdown." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dailyBreakdown.map(day => {
              const isOpen = expanded === day.date;
              const cats = Object.values(day.cats).sort((a, b) => b.amount - a.amount);
              const dateObj = new Date(day.date);
              const isToday = day.date === new Date().toISOString().slice(0, 10);
              return (
                <div key={day.date} style={{ borderRadius: 16, background: '#13151a', border: '1px solid ' + (isToday ? '#f0b42940' : '#1d2026'), overflow: 'hidden' }}>
                  {/* Day header row */}
                  <button
                    onClick={() => setExpanded(isOpen ? null : day.date)}
                    style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 10 }}
                  >
                    {/* Date badge */}
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: isToday ? 'rgba(240,180,41,0.15)' : '#1a1d23', border: '1px solid ' + (isToday ? '#f0b429' : '#23262c'), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: isToday ? '#f0b429' : '#e8e6e1', lineHeight: 1 }}>{dateObj.getDate()}</span>
                      <span style={{ fontSize: 9, color: isToday ? '#f0b429' : '#6b7280', lineHeight: 1.2 }}>{dateObj.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                    </div>
                    {/* Category mini chips */}
                    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, minWidth: 0 }}>
                      {cats.slice(0, 3).map((c, i) => (
                        <span key={i} style={{ fontSize: 11, background: c.color + '22', color: c.color, borderRadius: 100, padding: '2px 7px', fontWeight: 600 }}>
                          {c.icon} {fmt(c.amount)}
                        </span>
                      ))}
                      {cats.length > 3 && (
                        <span style={{ fontSize: 11, background: '#1d2026', color: '#6b7280', borderRadius: 100, padding: '2px 7px' }}>+{cats.length - 3}</span>
                      )}
                    </div>
                    {/* Total */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e6e1' }}>−{fmt(day.expense)}</div>
                      {day.income > 0 && <div style={{ fontSize: 10.5, color: '#4ade80' }}>+{fmt(day.income)}</div>}
                    </div>
                    <div style={{ color: '#4b5058', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <ChevronRight size={14} style={{ transform: 'rotate(90deg)' }} />
                    </div>
                  </button>

                  {/* Expanded category breakdown */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid #1d2026', padding: '10px 16px 14px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {cats.map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 16, width: 24, textAlign: 'center', flexShrink: 0 }}>{c.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontSize: 12.5, color: '#c9cdd3', fontWeight: 500 }}>{c.name}</span>
                                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{fmt(c.amount)}</span>
                              </div>
                              <div style={{ height: 4, borderRadius: 100, background: '#1d2026', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.round((c.amount / day.expense) * 100)}%`, background: c.color, borderRadius: 100 }} />
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: '#6b7280', width: 28, textAlign: 'right', flexShrink: 0 }}>
                              {Math.round((c.amount / day.expense) * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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

function SectionTitle({ children }) {
  return <div style={{ fontSize: 12.5, fontWeight: 600, color: '#6b7280', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{children}</div>;
}

function EmptyState({ icon, text }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', borderRadius: 16, background: '#13151a', border: '1px dashed #23262c' }}>
      <div style={{ color: '#3a3d44', marginBottom: 10, display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>{text}</div>
    </div>
  );
}

function BottomNav({ tab, setTab, onAdd }) {
  const items = [
    { id: 'home', label: 'Home', icon: Wallet },
    { id: 'daily', label: 'Daily', icon: BarChart2 },
    { id: 'budgets', label: 'Budgets', icon: Target },
    { id: 'recurring', label: 'Recurring', icon: Repeat },
  ];
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', position: 'relative', padding: '0 12px 20px' }}>
        <div style={{ background: '#13151a', border: '1px solid #1d2026', borderRadius: 100, padding: '8px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
          {items.slice(0, 2).map(item => <NavBtn key={item.id} item={item} active={tab === item.id} onClick={() => setTab(item.id)} />)}
          <button onClick={onAdd} style={{ width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg, #f0b429, #de9a1f)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(240,180,41,0.35)', flexShrink: 0 }}>
            <Plus size={22} color="#0b0d10" strokeWidth={2.5} />
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
    <button onClick={onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'transparent', border: 'none', color: active ? '#f0b429' : '#5b6068', padding: '6px 16px', flex: 1 }}>
      <Icon size={19} strokeWidth={active ? 2.4 : 2} />
      <span style={{ fontSize: 9.5, fontWeight: 600 }}>{item.label}</span>
    </button>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div className="sheet" style={{ width: '100%', maxWidth: 480, margin: '0 auto', background: '#15171c', borderRadius: '24px 24px 0 0', border: '1px solid #23262c', borderBottom: 'none', maxHeight: '88vh', overflowY: 'auto', padding: '20px 20px 28px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>{title}</h3>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', background: '#1d2026', border: 'none', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 12, background: '#1a1d23',
  border: '1px solid #262a31', color: '#e8e6e1', fontSize: 14.5, outline: 'none',
};
const labelStyle = { fontSize: 12, fontWeight: 600, color: '#8b9099', marginBottom: 6, display: 'block' };

function AddTransactionSheet({ categories, editingTx, onClose, onSaved }) {
  const [type, setType] = useState(editingTx?.type || 'expense');
  const [amount, setAmount] = useState(editingTx?.amount?.toString() || '');
  const [categoryId, setCategoryId] = useState(editingTx?.category_id || '');
  const [note, setNote] = useState(editingTx?.note || '');
  const [date, setDate] = useState(editingTx?.date || todayISO());
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
          amount: Number(amount), type, category_id: categoryId, note: note || null, date,
        }).eq('id', editingTx.id);
        if (error) throw error;
        onSaved('Transaction updated');
      } else {
        const { error } = await supabase.from('transactions').insert({
          amount: Number(amount), type, category_id: categoryId, note: note || null, date,
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
