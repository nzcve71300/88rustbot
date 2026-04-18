export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  inStock: boolean;
  // New fields for kit subscriptions
  subscriptionType?: 'monthly' | 'lifetime' | 'one-time' | 'free';
  monthlyPrice?: number;
  lifetimePrice?: number;
  cooldown?: string; // e.g., "3h", "24h", "48h"
  stockLimit?: number; // For limited items like God Bundle
  stockRemaining?: number;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar: string;
}

export type SortOption = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';

export interface FilterState {
  category: string;
  search: string;
  sort: SortOption;
}
