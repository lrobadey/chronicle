import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ConstellationAnimationProps {
  className?: string;
}

interface TwinklingStar {
  id: number;
  x: number;
  y: number;
  scale: number;
}

const ConstellationAnimation: React.FC<ConstellationAnimationProps> = ({ className }) => {
  const [twinklingStars, setTwinklingStars] = useState<TwinklingStar[]>([]);
  const starIdCounter = useRef(0);

  // Generate a random twinkling star in a circle around the world
  const generateRandomStar = (): TwinklingStar => {
    const worldRadius = 48; // World icon radius (96px diameter / 2)
    const constellationRadius = 80; // Distance from world center to constellation (increased)
    const constellationWidth = 30; // Width of the constellation belt (increased)
    
    // Random angle around the circle
    const angle = Math.random() * Math.PI * 2;
    
    // Random distance within the constellation belt
    const distance = constellationRadius + (Math.random() - 0.5) * constellationWidth;
    
    // Calculate position relative to world center
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    
    console.log('Generated star:', { x, y, angle: angle * 180 / Math.PI, distance });
    
    return {
      id: starIdCounter.current++,
      x: x,
      y: y,
      scale: 0.4 + Math.random() * 0.3 // Smaller stars
    };
  };

  // Spawn stars at regular intervals
  useEffect(() => {
    const interval = setInterval(() => {
      setTwinklingStars(prevStars => {
        // Remove stars that have been around too long (keep max 10 stars)
        const filteredStars = prevStars.slice(-9);
        return [...filteredStars, generateRandomStar()];
      });
    }, 400); // Spawn a new star every 400ms

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`relative ${className}`}>
      {/* Twinkling Stars with Framer Motion */}
      <AnimatePresence>
        {twinklingStars.map((star) => (
          <motion.div
            key={`star-${star.id}`}
            className="absolute w-2 h-2 rounded-full"
            style={{
              left: `calc(50% + ${star.x}px)`,
              top: `calc(50% + ${star.y}px)`,
              background: 'var(--aurora)',
              boxShadow: '0 0 8px var(--aurora)',
              zIndex: 5
            }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ 
              opacity: [0, 1, 0],
              scale: [0, star.scale * 1.5, 0],
              y: [0, -5, 0]
            }}
            transition={{ 
              duration: 2,
              ease: "easeInOut",
              times: [0, 0.3, 1]
            }}
            exit={{ opacity: 0, scale: 0 }}
          />
        ))}
      </AnimatePresence>

      {/* World Icon with Framer Motion */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <svg 
            className="w-24 h-24" 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="var(--aurora)" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
            style={{
              filter: 'drop-shadow(0 0 12px var(--aurora))'
            }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <motion.div 
            className="absolute inset-0 flex items-center justify-center"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
          >
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                background: 'var(--aurora)',
                boxShadow: '0 0 8px var(--aurora)'
              }}
            />
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default ConstellationAnimation; 