import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ImageViewerProps {
  imageUrl: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

const ImageViewer = ({ imageUrl, alt, isOpen, onClose }: ImageViewerProps) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-[101] p-3 sm:p-4 bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full backdrop-blur-sm transition-colors touch-target"
              aria-label="Close image viewer"
            >
              <X className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            </button>

            {/* Image Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-[95vw] max-h-[95vh] w-full h-full flex items-center justify-center p-4"
            >
              <img
                src={imageUrl}
                alt={alt}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                style={{ maxWidth: '100%', maxHeight: '100%' }}
              />
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ImageViewer;
