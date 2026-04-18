import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, ShoppingBag, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import Navbar from '@/components/Navbar';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import { toast } from 'sonner';

const CheckoutPage = () => {
  const { state, totalPrice, totalItems, clearCart } = useCart();
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(false);
  const [paypalClientId, setPaypalClientId] = useState<string | null>(null);

  useEffect(() => {
    // Get PayPal client ID from environment
    const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;
    if (!clientId) {
      console.error('PayPal Client ID not found in environment variables');
      toast.error('Payment system not configured. Please contact support.');
    }
    setPaypalClientId(clientId || null);
  }, []);

  // Redirect if cart is empty
  useEffect(() => {
    if (state.items.length === 0) {
      navigate('/store');
    }
  }, [state.items.length, navigate]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'EUR',
    }).format(price);
  };

  const createOrder = async (data: any, actions: any): Promise<string> => {
    try {
      console.log('Creating PayPal order...', { itemCount: state.items.length, total: totalPrice });
      
      const response = await fetch('/.netlify/functions/create-paypal-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: state.items.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          })),
          total: totalPrice,
          userId: user?.id,
          username: user?.username,
        }),
      });

      console.log('Order creation response:', {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Order creation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        });
        throw new Error(errorData.error || errorData.message || errorData.details || 'Failed to create order');
      }

      const data = await response.json();
      console.log('Order created successfully:', { orderId: data.orderId });
      
      if (!data.orderId) {
        console.error('No orderId in response:', data);
        throw new Error('Invalid response from server');
      }
      
      return data.orderId;
    } catch (error) {
      console.error('Error creating order:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create order. Please try again.';
      toast.error(errorMessage);
      // Re-throw to let PayPal handle the error
      throw error;
    }
  };

  const onApprove = async (data: { orderID: string }, actions: any) => {
    try {
      setIsProcessing(true);
      console.log('Capturing PayPal payment:', { orderID: data.orderID });
      
      const response = await fetch('/.netlify/functions/capture-paypal-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId: data.orderID,
          items: state.items,
          userId: user?.id,
          username: user?.username,
        }),
      });

      console.log('Capture response:', {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Capture failed:', errorData);
        throw new Error(errorData.error || errorData.message || 'Failed to capture payment');
      }

      const result = await response.json();
      console.log('Capture result:', result);
      
      if (result.success) {
        toast.success('Payment successful! Your items will be delivered shortly.');
        clearCart();
        setTimeout(() => {
          navigate('/store');
        }, 2000);
      } else {
        throw new Error(result.error || 'Payment failed');
      }
    } catch (error) {
      console.error('Error capturing payment:', error);
      const errorMessage = error instanceof Error ? error.message : 'Payment processing failed. Please try again.';
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const onError = (err: Record<string, unknown>) => {
    console.error('PayPal error:', err);
    toast.error('An error occurred with PayPal. Please try again.');
    setIsProcessing(false);
  };

  const onCancel = (data: Record<string, unknown>) => {
    console.log('PayPal payment cancelled:', data);
    setIsProcessing(false);
  };

  const handleFreeClaim = async () => {
    try {
      setIsProcessing(true);
      console.log('Claiming free items...', { itemCount: state.items.length, total: totalPrice });
      
      const response = await fetch('/.netlify/functions/claim-free-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: state.items,
          userId: user?.id,
          username: user?.username,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Free claim failed:', errorData);
        throw new Error(errorData.error || errorData.message || 'Failed to claim free items');
      }

      const result = await response.json();
      console.log('Free claim result:', result);
      
      if (result.success) {
        toast.success('Free items claimed successfully!');
        clearCart();
        setTimeout(() => {
          navigate('/store');
        }, 2000);
      } else {
        throw new Error(result.error || 'Failed to claim free items');
      }
    } catch (error) {
      console.error('Error claiming free items:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to claim free items. Please try again.';
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!paypalClientId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
        <Navbar />
        <div className="container mx-auto px-4 py-16 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading payment system...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <Navbar />
      
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => navigate('/store')}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Store
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Order Summary */}
          <div className="lg:col-span-2">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-2xl p-6 border border-border"
            >
              <div className="flex items-center gap-3 mb-6">
                <ShoppingBag className="w-6 h-6 text-primary" />
                <h1 className="text-2xl font-display font-bold">Order Summary</h1>
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
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{item.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Quantity: {item.quantity}
                      </p>
                      <p className="text-primary font-bold mt-2">
                        {formatPrice(item.price * item.quantity)}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Payment Section */}
          <div className="lg:col-span-1">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass rounded-2xl p-6 border border-border sticky top-8"
            >
              <div className="flex items-center gap-2 mb-6">
                <Lock className="w-5 h-5 text-primary" />
                <h2 className="text-xl font-display font-semibold">Secure Checkout</h2>
              </div>

              {/* Order Total */}
              <div className="space-y-4 mb-6 pb-6 border-b border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{formatPrice(totalPrice)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-medium">{totalItems}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2">
                  <span>Total</span>
                  <span className="text-primary">{formatPrice(totalPrice)}</span>
                </div>
              </div>

              {/* Free Items or PayPal Buttons */}
              {totalPrice === 0 ? (
                <div className="space-y-4">
                  {isProcessing && (
                    <div className="flex flex-col items-center justify-center py-8 mb-4">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                      <p className="text-sm text-muted-foreground">Claiming free items...</p>
                    </div>
                  )}
                  <Button
                    onClick={handleFreeClaim}
                    disabled={isProcessing}
                    className="w-full py-6 text-lg font-semibold bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
                    size="lg"
                  >
                    {isProcessing ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Claiming...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Lock className="w-5 h-5" />
                        Claim Free Items
                      </span>
                    )}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    These items are completely free - no payment required!
                  </p>
                </div>
              ) : (
                <PayPalScriptProvider
                  options={{
                    clientId: paypalClientId || '',
                    currency: 'EUR',
                    intent: 'capture',
                  }}
                >
                  {isProcessing && (
                    <div className="flex flex-col items-center justify-center py-8 mb-4">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                      <p className="text-sm text-muted-foreground">Processing payment...</p>
                    </div>
                  )}
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
              )}

              {/* Security Notice */}
              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p>
                    Your payment is secured by PayPal. We never store your payment information.
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
