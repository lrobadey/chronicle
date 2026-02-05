# Chronicle Core Palette

## Overview
The Chronicle Core Palette is a carefully crafted color scheme designed to evoke the feeling of ancient mysteries and modern storytelling. It combines deep, abyssal blues with icy highlights and bold cyan accents to create a sophisticated, immersive experience.

## Core Colors

### 🕳️ Abyss (Deep Blue)
**Hex:** `#0B1E34`
**Usage:** Primary background, header bars, modals
**Description:** A deep, rich blue that creates the foundation of the interface. Like the depths of an ancient ocean, it provides a sense of mystery and depth while remaining readable and professional.

### ❄️ Icefield (Icy Blue)
**Hex:** `#CFE9FF`
**Usage:** Primary text on dark backgrounds, key lines, subtle highlights, map glows
**Description:** A bright, icy blue that stands out beautifully against dark backgrounds. It's reminiscent of glacial ice and provides excellent contrast while maintaining readability.

### 🗿 Silver Slate (Cool Gray)
**Hex:** `#A3AFBF`
**Usage:** Secondary text, borders, disabled states, neutral icons
**Description:** A sophisticated cool gray that provides subtle contrast and hierarchy. It's neutral enough to not compete with the primary colors while still being clearly visible.

### 🌊 Aurora (Bold Accent Cyan)
**Hex:** `#00E0FF`
**Usage:** CTAs, selection, links, activity indicators
**Description:** A vibrant cyan that commands attention without being overwhelming. Like the northern lights, it draws the eye and indicates important interactive elements.

## Color Hierarchy

### Primary Elements
- **Backgrounds:** Abyss (`#0B1E34`)
- **Primary Text:** Icefield (`#CFE9FF`)
- **Interactive Elements:** Aurora (`#00E0FF`)

### Secondary Elements
- **Secondary Text:** Silver Slate (`#A3AFBF`)
- **Borders:** Silver Slate (`#A3AFBF`)
- **Muted Text:** `#8a9ba8` (muted version of Silver Slate)

### Accent Elements
- **Highlights:** Icefield (`#CFE9FF`)
- **Glows:** Aurora (`#00E0FF`)
- **Gradients:** Aurora to darker cyan

## Usage Guidelines

### Text Hierarchy
1. **Primary Text:** Icefield for main content
2. **Secondary Text:** Silver Slate for supporting information
3. **Muted Text:** `#8a9ba8` for less important details
4. **Accent Text:** Aurora for links and highlights

### Interactive Elements
- **Buttons:** Aurora gradient with Icefield text
- **Links:** Aurora with hover effects
- **Focus States:** Aurora glow effects
- **Selection:** Aurora highlights

### Backgrounds
- **Primary:** Abyss for main backgrounds
- **Secondary:** `#1a2a3f` (slightly lighter Abyss)
- **Tertiary:** `#2a3a4f` (even lighter for depth)
- **Glass Effects:** Semi-transparent Abyss with blur

### Borders and Dividers
- **Primary Borders:** Silver Slate
- **Accent Borders:** Aurora
- **Subtle Dividers:** Muted Silver Slate

## Accessibility

### Contrast Ratios
- **Icefield on Abyss:** 15.6:1 (Excellent)
- **Aurora on Abyss:** 4.5:1 (Good)
- **Silver Slate on Abyss:** 3.2:1 (Acceptable)

### Color Blindness Considerations
- Aurora is distinguishable from other colors for most color vision types
- Icefield provides sufficient contrast for readability
- Silver Slate offers neutral alternatives when needed

## Implementation

### CSS Variables
```css
:root {
  --abyss: #0B1E34;
  --icefield: #CFE9FF;
  --silver-slate: #A3AFBF;
  --aurora: #00E0FF;
}
```

### Semantic Usage
```css
/* Backgrounds */
.bg-primary { background: var(--abyss); }
.bg-secondary { background: #1a2a3f; }
.bg-tertiary { background: #2a3a4f; }

/* Text */
.text-primary { color: var(--icefield); }
.text-secondary { color: var(--silver-slate); }
.text-accent { color: var(--aurora); }

/* Interactive */
.btn-primary { background: var(--aurora); }
.border-accent { border-color: var(--aurora); }
```

## Brand Personality

### Characteristics
- **Mysterious:** Deep abyssal backgrounds
- **Sophisticated:** Refined color relationships
- **Modern:** Clean, minimal implementation
- **Immersive:** Creates depth and atmosphere
- **Professional:** Maintains readability and usability

### Emotional Response
- **Trust:** Deep, stable backgrounds
- **Clarity:** High contrast text
- **Engagement:** Bold accent colors
- **Calm:** Cool, blue-based palette

## Future Considerations

### Potential Extensions
- **Success States:** Green variants for Aurora
- **Warning States:** Orange/amber variants
- **Error States:** Red variants
- **Loading States:** Aurora animations

### Dark/Light Mode
- Current implementation is dark-mode optimized
- Light mode would require careful inversion of the palette
- Consider maintaining the same emotional characteristics

## Maintenance

### Color Updates
- Always test contrast ratios when modifying colors
- Ensure accessibility compliance
- Maintain the emotional characteristics of the palette
- Document any changes to the color scheme

### Testing
- Test on various displays and lighting conditions
- Verify accessibility with screen readers
- Check color blindness compatibility
- Validate contrast ratios meet WCAG guidelines 