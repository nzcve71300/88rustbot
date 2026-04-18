import { motion } from 'framer-motion';
import { X, ShoppingCart, Check, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Product } from '@/types/store';
import { useCart } from '@/context/CartContext';
import { useState, useEffect } from 'react';
import ImageViewer from './ImageViewer';

interface ProductModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
}

const ProductModal = ({ product, isOpen, onClose }: ProductModalProps) => {
  const { addItem } = useCart();
  const [isAdded, setIsAdded] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<number>(product.price);

  // Initialize selected price when modal opens
  useEffect(() => {
    if (product.subscriptionType === 'monthly' && product.monthlyPrice) {
      setSelectedPrice(product.monthlyPrice);
    } else {
      setSelectedPrice(product.price);
    }
  }, [product]);

  if (!product || !isOpen) return null;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'EUR',
    }).format(price);
  };

  const handleAddToCart = () => {
    // Create a product with the selected price for subscription items
    const productToAdd = product.subscriptionType === 'monthly' && selectedPrice !== product.price
      ? { ...product, price: selectedPrice }
      : product;
    
    addItem(productToAdd);
    setIsAdded(true);
    setTimeout(() => {
      setIsAdded(false);
      onClose();
    }, 1000);
  };

  return (
    <>
      {/* Backdrop with flexbox centering */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      >
        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg max-h-[90vh] overflow-auto
                     glass rounded-2xl z-50 flex flex-col shadow-2xl"
        >
        {/* Header with close button */}
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-border glass">
          <span className="text-xs font-medium text-primary uppercase tracking-wider">
            {product.category}
          </span>
          <button
            onClick={onClose}
            className="touch-target p-2 hover:bg-muted/50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 sm:p-6 space-y-6">
          {/* Image - Clickable for fullscreen */}
          <div 
            className="relative aspect-video bg-muted rounded-xl overflow-hidden group cursor-pointer"
            onClick={() => setIsImageViewerOpen(true)}
          >
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {/* View Fullscreen Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsImageViewerOpen(true);
              }}
              className="absolute top-3 right-3 p-3 bg-black/60 hover:bg-black/80 active:bg-black/90 backdrop-blur-sm rounded-lg transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 touch-target z-10"
              aria-label="View image fullscreen"
            >
              <Eye className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Image Viewer */}
          <ImageViewer
            imageUrl={product.image}
            alt={product.name}
            isOpen={isImageViewerOpen}
            onClose={() => setIsImageViewerOpen(false)}
          />

          {/* Product Info */}
          <div className="space-y-4">
            <h2 className="font-display text-2xl sm:text-3xl font-bold">
              {product.name}
            </h2>

            {/* Price Display with Subscription Options */}
            {product.subscriptionType === 'monthly' && product.monthlyPrice && product.lifetimePrice ? (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedPrice(product.monthlyPrice!)}
                    className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                      selectedPrice === product.monthlyPrice
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <p className="text-lg font-bold">Monthly</p>
                    <p className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                      {formatPrice(product.monthlyPrice)}/mo
                    </p>
                  </button>
                  <button
                    onClick={() => setSelectedPrice(product.lifetimePrice!)}
                    className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                      selectedPrice === product.lifetimePrice
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <p className="text-lg font-bold">Lifetime</p>
                    <p className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                      {formatPrice(product.lifetimePrice)}
                    </p>
                  </button>
                </div>
                <p className="text-center text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  {formatPrice(selectedPrice)}
                </p>
              </div>
            ) : product.subscriptionType === 'free' ? (
              <p className="text-3xl font-bold text-green-500">FREE</p>
            ) : (
              <p className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                {formatPrice(product.price)}
              </p>
            )}

            {/* Additional Info */}
            <div className="space-y-2">
              {product.cooldown && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium">Cooldown:</span> {product.cooldown}
                </p>
              )}
              {product.stockLimit && (
                <p className="text-sm text-orange-500 font-medium">
                  <span className="font-medium">Limited Stock:</span> Only {product.stockRemaining || product.stockLimit} remaining!
                </p>
              )}
              {product.subscriptionType && (
                <p className="text-sm text-muted-foreground capitalize">
                  Type: {product.subscriptionType.replace('-', ' ')}
                </p>
              )}
            </div>

            <p className="text-muted-foreground leading-relaxed">
              {product.description}
            </p>

            {/* Stock Status */}
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${product.inStock ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-muted-foreground">
                {product.inStock ? 'In Stock' : 'Out of Stock'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 p-4 border-t border-border glass">
          <Button
            onClick={handleAddToCart}
            disabled={!product.inStock || isAdded}
            className={`w-full touch-target py-6 text-base font-display font-semibold transition-all
                       ${isAdded 
                         ? 'bg-green-600 hover:bg-green-600' 
                         : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90'
                       }`}
          >
            {isAdded ? (
              <span className="flex items-center gap-2">
                <Check className="w-5 h-5" />
                Added to Cart!
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                Add to Cart
              </span>
            )}
          </Button>
        </div>
        </motion.div>
      </motion.div>
    </>
  );
};

export default ProductModal;
