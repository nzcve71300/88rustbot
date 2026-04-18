-- Lucid Store Hub - Orders Table
-- This table stores PayPal order information

CREATE TABLE IF NOT EXISTS lucid_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL UNIQUE,
  paypal_order_id VARCHAR(255) NOT NULL,
  paypal_transaction_id VARCHAR(255),
  user_id VARCHAR(255),
  username VARCHAR(255),
  items JSON NOT NULL,
  total_amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_paypal_order_id (paypal_order_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
