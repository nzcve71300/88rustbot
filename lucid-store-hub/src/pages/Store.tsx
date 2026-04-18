import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import CartDrawer from '@/components/CartDrawer';
import ProductCard from '@/components/ProductCard';
import ProductModal from '@/components/ProductModal';
import StoreFilters from '@/components/StoreFilters';
import { products } from '@/data/products';
import { Product, FilterState } from '@/types/store';

const StorePage = () => {
  const { isAuthenticated, login, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    category: searchParams.get('category') || 'All',
    search: '',
    sort: 'name-asc',
  });

  // Update filters when URL category changes
  useEffect(() => {
    const categoryParam = searchParams.get('category');
    const currentCategory = categoryParam || 'All';
    if (currentCategory !== filters.category) {
      setFilters(prev => ({ ...prev, category: currentCategory }));
    }
  }, [searchParams]);

  // Update URL when category filter changes (but only if different from URL)
  useEffect(() => {
    const urlCategory = searchParams.get('category') || 'All';
    if (filters.category !== urlCategory) {
      const newParams = new URLSearchParams(searchParams);
      if (filters.category === 'All') {
        newParams.delete('category');
      } else {
        newParams.set('category', filters.category);
      }
      setSearchParams(newParams, { replace: true });
    }
  }, [filters.category, searchParams, setSearchParams]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      login(); // Auto-login for demo, replace with redirect to login page
    }
  }, [isAuthenticated, isLoading, login]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Filter by category
    if (filters.category !== 'All') {
      if (filters.category === 'All Kits') {
        // Show all kits (everything except VIP and Lucid God Packs)
        result = result.filter(p => p.category !== 'Lucid God Packs' && p.category !== 'VIP');
      } else {
        result = result.filter(p => p.category === filters.category);
      }
    }

    // Filter by search
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(
        p =>
          p.name.toLowerCase().includes(searchLower) ||
          p.description.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    switch (filters.sort) {
      case 'name-asc':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        result.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'price-asc':
        result.sort((a, b) => a.price - b.price);
        break;
      case 'price-desc':
        result.sort((a, b) => b.price - a.price);
        break;
    }

    return result;
  }, [products, filters]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.img
          src="/Fav_icon.png"
          alt="Loading"
          className="w-16 h-16 animate-spin"
          animate={{
            filter: [
              'drop-shadow(0 0 10px hsl(263, 70%, 58%, 0.6))',
              'drop-shadow(0 0 20px hsl(185, 80%, 45%, 0.6))',
              'drop-shadow(0 0 10px hsl(263, 70%, 58%, 0.6))',
            ],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <CartDrawer />

      {/* Product Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <ProductModal
            product={selectedProduct}
            isOpen={!!selectedProduct}
            onClose={() => setSelectedProduct(null)}
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="pt-20 sm:pt-24 pb-8 px-4">
        <div className="container mx-auto max-w-7xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-8"
          >
            <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold mb-2">
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Store
              </span>
            </h1>
            <p className="text-muted-foreground">
              Browse our premium Rust console items
            </p>
          </motion.div>

          {/* Filters */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            <StoreFilters filters={filters} onFilterChange={setFilters} />
          </motion.div>

          {/* Products Grid */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            {filteredProducts.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-lg">No products found</p>
                <button
                  onClick={() => setFilters({ category: 'All', search: '', sort: 'name-asc' })}
                  className="mt-4 text-primary hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 items-stretch">
                <AnimatePresence mode="popLayout">
                  {filteredProducts.map((product, index) => (
                    <motion.div
                      key={product.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="h-full"
                    >
                      <ProductCard
                        product={product}
                        onViewDetails={setSelectedProduct}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>

          {/* Results count */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-center text-sm text-muted-foreground mt-8"
          >
            Showing {filteredProducts.length} of {products.length} products
          </motion.p>
        </div>
      </main>
    </div>
  );
};

export default StorePage;
