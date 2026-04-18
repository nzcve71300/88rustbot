import { motion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal, X, Check } from 'lucide-react';
import { categories } from '@/data/products';
import { FilterState, SortOption } from '@/types/store';
import { useState } from 'react';

interface StoreFiltersProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
}

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'price-asc', label: 'Price (Low to High)' },
  { value: 'price-desc', label: 'Price (High to Low)' },
];

const StoreFilters = ({ filters, onFilterChange }: StoreFiltersProps) => {
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  const handleCategoryChange = (category: string) => {
    onFilterChange({ ...filters, category });
  };

  const handleSortChange = (sort: SortOption) => {
    onFilterChange({ ...filters, sort });
    setIsSortOpen(false);
  };

  const handleSearchChange = (search: string) => {
    onFilterChange({ ...filters, search });
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search products..."
          value={filters.search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full h-12 px-4 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground
                   focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
        />
        {filters.search && (
          <button
            onClick={() => handleSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Mobile Filters Toggle */}
      <div className="flex items-center gap-3 sm:hidden">
        <button
          onClick={() => setIsMobileFiltersOpen(!isMobileFiltersOpen)}
          className="flex-1 flex items-center justify-center gap-2 h-12 bg-card border border-border rounded-xl
                   hover:border-primary/50 transition-colors touch-target"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-sm font-medium">Filters</span>
        </button>

        {/* Sort Dropdown - Mobile */}
        <div className="relative flex-1">
          <button
            onClick={() => setIsSortOpen(!isSortOpen)}
            className="w-full flex items-center justify-center gap-2 h-12 bg-card border border-border rounded-xl
                     hover:border-primary/50 transition-colors touch-target"
          >
            <span className="text-sm font-medium">Sort</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${isSortOpen ? 'rotate-180' : ''}`} />
          </button>

          {isSortOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsSortOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-full left-0 right-0 mt-2 glass rounded-xl overflow-hidden z-50"
              >
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSortChange(option.value)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50 transition-colors touch-target"
                  >
                    {option.label}
                    {filters.sort === option.value && <Check className="w-4 h-4 text-primary" />}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </div>
      </div>

      {/* Mobile Categories */}
      {isMobileFiltersOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="sm:hidden"
        >
          <div className="p-4 bg-card border border-border rounded-xl space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Categories
            </p>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => handleCategoryChange(category)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all touch-target
                            ${filters.category === category
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
                            }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Desktop Filters */}
      <div className="hidden sm:flex items-center justify-between gap-4">
        {/* Category Pills */}
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => handleCategoryChange(category)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all
                        ${filters.category === category
                          ? 'bg-primary text-primary-foreground glow-purple'
                          : 'bg-card border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground'
                        }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Sort Dropdown - Desktop */}
        <div className="relative">
          <button
            onClick={() => setIsSortOpen(!isSortOpen)}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg
                     hover:border-primary/50 transition-colors"
          >
            <span className="text-sm font-medium">
              {sortOptions.find(o => o.value === filters.sort)?.label}
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${isSortOpen ? 'rotate-180' : ''}`} />
          </button>

          {isSortOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsSortOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-full right-0 mt-2 w-48 glass rounded-xl overflow-hidden z-50"
              >
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSortChange(option.value)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
                  >
                    {option.label}
                    {filters.sort === option.value && <Check className="w-4 h-4 text-primary" />}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default StoreFilters;
