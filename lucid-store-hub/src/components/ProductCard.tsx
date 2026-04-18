import { motion } from 'framer-motion';
import { ShoppingCart, Check, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Product } from '@/types/store';
import { useCart } from '@/context/CartContext';
import { useState } from 'react';
import ImageViewer from './ImageViewer';

interface ProductCardProps {
  product: Product;
  onViewDetails: (product: Product) => void;
}

const ProductCard = ({ product, onViewDetails }: ProductCardProps) => {
  const { addItem } = useCart();
  const [isAdded, setIsAdded] = useState(false);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'EUR',
    }).format(price);
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    addItem(product);
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 1500);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      onClick={() => onViewDetails(product)}
      className="group relative bg-gradient-card rounded-xl border border-border overflow-hidden cursor-pointer
                 transition-all duration-300 hover:border-primary/50 hover:shadow-[0_0_30px_hsl(263,70%,58%,0.2)]
                 flex flex-col h-full"
    >
      {/* Glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Image */}
      <div className="relative aspect-square bg-muted overflow-hidden">
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
        {/* Category Badge */}
        <span className="absolute top-3 left-3 px-2 py-1 text-xs font-medium bg-primary/90 text-primary-foreground rounded-md">
          {product.category}
        </span>
        {/* View Button - Always visible on mobile, hover on desktop */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsImageViewerOpen(true);
          }}
          className="absolute top-3 right-3 p-2 sm:p-2.5 bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded-lg transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 touch-target z-10"
          aria-label="View image fullscreen"
        >
          <Eye className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </button>
      </div>

      {/* Image Viewer */}
      <ImageViewer
        imageUrl={product.image}
        alt={product.name}
        isOpen={isImageViewerOpen}
        onClose={() => setIsImageViewerOpen(false)}
      />

      {/* Content - Flex container to push button to bottom */}
      <div className="relative p-4 space-y-3 flex flex-col flex-grow">
        <h3 
          className="font-display font-semibold text-base sm:text-lg leading-tight group-hover:text-primary transition-colors overflow-hidden"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            minHeight: '3rem',
            maxHeight: '3rem',
            lineHeight: '1.5rem'
          }}
          title={product.name}
        >
          {product.name}
        </h3>

        {/* Price Display - Fixed height */}
        <div className="space-y-1 min-h-[4rem]">
          {product.subscriptionType === 'monthly' && product.monthlyPrice && product.lifetimePrice ? (
            <div className="space-y-1">
              <p className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                {formatPrice(product.monthlyPrice)}/mo
              </p>
              <p className="text-sm text-muted-foreground">
                or {formatPrice(product.lifetimePrice)} lifetime
              </p>
            </div>
          ) : product.subscriptionType === 'free' ? (
            <p className="text-2xl font-bold text-green-500">FREE</p>
          ) : (
            <p className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {formatPrice(product.price)}
            </p>
          )}
          {product.cooldown && (
            <p className="text-xs text-muted-foreground">Cooldown: {product.cooldown}</p>
          )}
          {product.stockLimit && (
            <p className="text-xs text-orange-500 font-medium">
              Only {product.stockRemaining || product.stockLimit} left!
            </p>
          )}
        </div>

        {/* Add to Cart Button - Always at bottom */}
        <Button
          onClick={handleAddToCart}
          disabled={isAdded}
          className={`w-full touch-target py-5 font-medium transition-all duration-300 mt-auto
                     ${isAdded 
                       ? 'bg-green-600 hover:bg-green-600' 
                       : 'bg-secondary hover:bg-primary text-secondary-foreground hover:text-primary-foreground'
                     }`}
        >
          {isAdded ? (
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              Added!
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Add to Cart
            </span>
          )}
        </Button>
      </div>
    </motion.div>
  );
};

export default ProductCard;
