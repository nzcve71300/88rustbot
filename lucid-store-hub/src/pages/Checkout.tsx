import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, ShoppingBag, Loader2, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import Navbar from '@/components/Navbar';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import { toast } from 'sonner';
import { LUCIDS_ICON_URL } from '@/lib/kitsCatalog';
import type { CartItem } from '@/types/store';

function cartSig(items: CartItem[]) {
  return items
    .map((i) => `${i.id}:${i.quantity}`)
    .sort()
    .join('|');
}

type HybridApplied = {
  lucidsSpent: number;
  remainderEur: number;
  totalEur: number;
  cartSig: string;
};

const CheckoutPage = () => {
  const { state, totalPrice, totalItems, totalLucids, clearCart } = useCart();
  const { isAuthenticated, user, refreshLucids } = useAuth();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);
  const paypalClientId = (import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined)?.trim() || '';

  const [paymentMethod, setPaymentMethod] = useState<'paypal' | 'lucids'>(() =>
    paypalClientId ? 'paypal' : 'lucids'
  );
  const [hybridApplied, setHybridApplied] = useState<HybridApplied | null>(null);

  const balance = user?.lucids ?? 0;
  const canAffordLucids = totalLucids <= balance && totalLucids > 0;
  const paypalChargeTotal = hybridApplied?.remainderEur ?? totalPrice;

  const showSubtractLucids =
    !!paypalClientId && balance > 0 && !canAffordLucids && totalLucids > 0;

  const releaseHybridAndRefresh = useCallback(async () => {
    const sessionToken = localStorage.getItem('lucid-clans-session-token');
    if (!sessionToken) {
      setHybridApplied(null);
      return;
    }
    try {
      await fetch('/.netlify/functions/release-checkout-lucids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken }),
      });
    } catch {
      /* non-fatal */
    }
    setHybridApplied(null);
    await refreshLucids();
  }, [refreshLucids]);

  const paypalButtonsKey = useMemo(
    () => `pp-${hybridApplied?.remainderEur ?? totalPrice}-${balance}`,
    [hybridApplied?.remainderEur, totalPrice, balance]
  );

  useEffect(() => {
    if (!hybridApplied) return;
    if (cartSig(state.items) !== hybridApplied.cartSig) {
      void releaseHybridAndRefresh().then(() =>
        toast.info('Lucids credit removed — your cart changed. Your balance was restored.')
      );
    }
  }, [state.items, hybridApplied, releaseHybridAndRefresh]);

  useEffect(() => {
    if (paymentMethod === 'lucids' && hybridApplied) {
      void releaseHybridAndRefresh().then(() =>
        toast.info('Lucids credit removed — you switched to paying fully with Lucids.')
      );
    }
  }, [paymentMethod, hybridApplied, releaseHybridAndRefresh]);

  useEffect(() => {
    if (state.items.length === 0) {
      navigate('/store');
    }
  }, [state.items.length, navigate]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (paymentMethod === 'paypal' && !paypalClientId) {
      setPaymentMethod('lucids');
    }
  }, [paymentMethod, paypalClientId]);

  const formatEur = (n: number) =>
    new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n);

  const createOrder = async (_data: unknown, _actions: unknown): Promise<string> => {
    const sessionToken = localStorage.getItem('lucid-clans-session-token') || '';
    const response = await fetch('/.netlify/functions/create-paypal-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.items.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
        total: paypalChargeTotal,
        userId: user?.id,
        username: user?.username,
        ...(sessionToken ? { sessionToken } : {}),
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        details?: string;
      };
      const msg =
        errorData.details ||
        errorData.message ||
        errorData.error ||
        'Failed to create order';
      throw new Error(msg);
    }
    const data = await response.json();
    if (!data.orderId) throw new Error('Invalid response from server');
    return data.orderId as string;
  };

  const onApprove = async (data: { orderID: string }) => {
    try {
      setIsProcessing(true);
      const response = await fetch('/.netlify/functions/capture-paypal-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: data.orderID,
          items: state.items,
          userId: user?.id,
          username: user?.username,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as { error?: string }).error || 'Failed to capture payment');
      }

      const result = await response.json();
      if (result.success) {
        setHybridApplied(null);
        if (result.fulfillmentWarning) {
          toast.warning(
            `Payment recorded. Discord delivery issue: ${String(result.fulfillmentWarning)}`,
            { duration: 12000 }
          );
        } else {
          toast.success('Payment successful! Roles will be applied shortly in Discord.');
        }
        clearCart();
        void refreshLucids();
        setTimeout(() => navigate('/store'), 2000);
      } else {
        throw new Error(result.error || 'Payment failed');
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Payment failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const onError = (err: Record<string, unknown>) => {
    console.error(err);
    toast.error('PayPal error. Please try again.');
    setIsProcessing(false);
  };

  const onCancel = () => setIsProcessing(false);

  const payWithLucids = async () => {
    if (!canAffordLucids) {
      toast.error('Not enough Lucids for this cart.');
      return;
    }
    const sessionToken = localStorage.getItem('lucid-clans-session-token');
    if (!sessionToken) {
      toast.error('Session expired — please log in again.');
      return;
    }
    try {
      setIsProcessing(true);
      const response = await fetch('/.netlify/functions/purchase-with-lucids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          items: state.items.map((i) => ({ id: i.id, quantity: i.quantity })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        const msg =
          (body as { detail?: string; message?: string }).detail ||
          (body as { message?: string }).message ||
          (body as { error?: string }).error ||
          `Purchase failed (${response.status})`;
        throw new Error(msg);
      }
      toast.success('Purchase successful! Roles will be applied shortly in Discord.');
      clearCart();
      await refreshLucids();
      setTimeout(() => navigate('/store'), 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lucids purchase failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const applySubtractLucids = async () => {
    if (!showSubtractLucids || hybridApplied) return;
    const sessionToken = localStorage.getItem('lucid-clans-session-token');
    if (!sessionToken) {
      toast.error('Session expired — please log in again.');
      return;
    }
    try {
      setIsProcessing(true);
      const res = await fetch('/.netlify/functions/apply-checkout-lucids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          items: state.items.map((i) => ({ id: i.id, quantity: i.quantity })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        lucidsSpent?: number;
        remainderEur?: number;
        totalEur?: number;
        cartSig?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Could not apply Lucids (${res.status})`);
      }
      const lucidsSpent = Math.max(0, Math.floor(Number(body.lucidsSpent ?? 0)));
      const remainderEur = Number(body.remainderEur);
      const totalEur = Number(body.totalEur);
      const sig = String(body.cartSig || '');
      if (!Number.isFinite(remainderEur) || !sig) {
        throw new Error('Invalid apply response');
      }
      setHybridApplied({
        lucidsSpent,
        remainderEur,
        totalEur: Number.isFinite(totalEur) ? totalEur : totalPrice,
        cartSig: sig,
      });
      setPaymentMethod('paypal');
      await refreshLucids();
      toast.success(
        `Applied ${lucidsSpent.toLocaleString()} Lucids (€${(lucidsSpent / 100).toFixed(2)}). Pay €${remainderEur.toFixed(2)} with PayPal.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply Lucids');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent">
      <Navbar />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <Button variant="ghost" onClick={() => navigate('/store')} className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Store
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-2xl p-6 border border-border"
            >
              <div className="flex items-center gap-3 mb-6">
                <ShoppingBag className="w-6 h-6 text-primary" />
                <h1 className="text-2xl font-display font-bold">Order summary</h1>
              </div>

              <div className="space-y-4">
                {state.items.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex gap-4 p-4 bg-card rounded-xl border border-border"
                  >
                    <div className="w-20 h-20 flex-shrink-0 rounded-lg bg-muted overflow-hidden">
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg leading-snug">{item.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">Qty: {item.quantity}</p>
                      <p className="text-primary font-bold mt-1">{formatEur(item.price * item.quantity)}</p>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                        <img src={LUCIDS_ICON_URL} alt="" className="w-4 h-4 object-contain" />
                        <span className="font-medium text-foreground tabular-nums">
                          {(item.lucidsPrice * item.quantity).toLocaleString()} Lucids
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-1">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass rounded-2xl p-6 border border-border lg:sticky lg:top-24"
            >
              <div className="flex items-center gap-2 mb-4">
                <Lock className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-display font-semibold">Checkout</h2>
              </div>

              <div className="space-y-3 mb-6 pb-6 border-b border-border text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatEur(totalPrice)}</span>
                </div>
                <div className="flex justify-between gap-2 items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <img src={LUCIDS_ICON_URL} alt="" className="w-4 h-4" /> Lucids total
                  </span>
                  <span className="font-semibold tabular-nums">{totalLucids.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-medium">{totalItems}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2">
                  <span>{hybridApplied ? 'Order total' : 'Total'}</span>
                  <span className="text-primary">{formatEur(totalPrice)}</span>
                </div>
                {hybridApplied ? (
                  <>
                    <div className="flex justify-between gap-2 text-emerald-600 dark:text-emerald-400">
                      <span className="font-medium">Lucids applied</span>
                      <span className="tabular-nums">
                        −{hybridApplied.lucidsSpent.toLocaleString()} (−{formatEur(hybridApplied.lucidsSpent / 100)})
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 text-lg font-bold pt-1 border-t border-border/60">
                      <span>PayPal due</span>
                      <span className="text-primary">{formatEur(paypalChargeTotal)}</span>
                    </div>
                  </>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {totalLucids.toLocaleString()} Lucids ({formatEur(totalLucids / 100)} value)
                </p>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-muted-foreground">Your balance</span>
                  <span className="font-semibold tabular-nums flex items-center gap-1">
                    <img src={LUCIDS_ICON_URL} alt="" className="w-4 h-4" />
                    {balance.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <Label className="text-sm font-medium">Payment method</Label>
                <RadioGroup
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as 'paypal' | 'lucids')}
                  className="grid gap-3"
                >
                  {paypalClientId ? (
                    <label
                      htmlFor="pay-paypal"
                      className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${
                        paymentMethod === 'paypal' ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <RadioGroupItem value="paypal" id="pay-paypal" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">PayPal</div>
                        <div className="text-xs text-muted-foreground">Pay in EUR via PayPal</div>
                      </div>
                    </label>
                  ) : null}

                  <label
                    htmlFor="pay-lucids"
                    className={`flex items-center gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${
                      paymentMethod === 'lucids' ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <RadioGroupItem value="lucids" id="pay-lucids" />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Coins className="w-5 h-5 text-accent flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium">Lucids</div>
                        <div className="text-xs text-muted-foreground">Spend from your linked balance</div>
                      </div>
                    </div>
                  </label>
                </RadioGroup>

                {paymentMethod === 'lucids' && !canAffordLucids && (
                  <p className="text-sm text-destructive">
                    You need <span className="font-semibold">{totalLucids.toLocaleString()}</span> Lucids but only
                    have <span className="font-semibold">{balance.toLocaleString()}</span>.
                  </p>
                )}

                {paymentMethod === 'paypal' && hybridApplied ? (
                  <p className="text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/30">
                    <span className="font-medium text-foreground">Lucids applied.</span> Complete payment with PayPal
                    below for <span className="font-semibold">{formatEur(paypalChargeTotal)}</span>.
                  </p>
                ) : null}

                {paymentMethod === 'paypal' && showSubtractLucids && !hybridApplied ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                    <p className="text-xs text-amber-200/90 leading-relaxed">
                      <span className="font-semibold text-amber-100">Warning:</span> The button below immediately
                      spends <strong>all</strong> your current Lucids toward this order (100 Lucids = €1.00). That amount
                      is removed from your balance right away. You will pay the rest with PayPal. If you edit your cart,
                      applied Lucids are refunded automatically. Abandoning checkout does not refund Lucids — switch to{" "}
                      <strong>Lucids</strong> above to restore them when you have enough for the full cart.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-amber-500/50 hover:bg-amber-500/15"
                      disabled={isProcessing}
                      onClick={() => void applySubtractLucids()}
                    >
                      Subtract my Lucids toward PayPal
                    </Button>
                  </div>
                ) : null}

                {isProcessing && (
                  <div className="flex flex-col items-center justify-center py-6">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
                    <p className="text-sm text-muted-foreground">Processing…</p>
                  </div>
                )}

                {paymentMethod === 'lucids' ? (
                  <Button
                    type="button"
                    onClick={payWithLucids}
                    disabled={isProcessing || !canAffordLucids}
                    className="w-full py-6 text-lg font-semibold bg-gradient-to-r from-accent to-primary"
                  >
                    Pay with Lucids
                  </Button>
                ) : paypalClientId ? (
                  <PayPalScriptProvider
                    key={paypalButtonsKey}
                    options={{
                      clientId: paypalClientId,
                      currency: 'EUR',
                      intent: 'capture',
                    }}
                  >
                    <PayPalButtons
                      createOrder={createOrder}
                      onApprove={onApprove}
                      onError={onError}
                      onCancel={onCancel}
                      disabled={isProcessing}
                      style={{
                        layout: 'vertical',
                        color: 'gold',
                        shape: 'rect',
                        label: 'paypal',
                      }}
                    />
                  </PayPalScriptProvider>
                ) : (
                  <p className="text-sm text-muted-foreground">PayPal is not configured for this deployment.</p>
                )}

                <div className="flex items-start gap-2 text-xs text-muted-foreground pt-4 border-t border-border">
                  <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p>
                    Lucids purchases are debited atomically on the server — you cannot go negative. Role delivery is
                    handled by the Lucid Discord bot (usually within ~30 seconds).
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutPage;
