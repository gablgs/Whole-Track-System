import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  venueTitle: string;
  supervisorName: string;
  dressCode: string;
}

export function WorksiteGuideModal({ isOpen, onClose, venueTitle, supervisorName, dressCode }: Props) {
  const [currentSlide, setCurrentSlide] = useState(0);

  if (!isOpen) return null;

  const slides = [
    {
      kicker: 'Quick Guide',
      title: `Welcome to ${venueTitle}`,
      copy: 'If this is your first time here, review these steps so you know exactly where to report when you arrive on site.',
      image: 'https://i.postimg.cc/05tKG13g/IMG-0518.png',
      caption: 'Main entrance and drop-off area',
    },
    {
      kicker: 'Step 1',
      title: 'Look for the Conference Centre entrance',
      copy: 'This is the entrance our staff team uses. Follow the overhead signs once you arrive on the grounds.',
      image: 'https://i.postimg.cc/vHs86q8M/IMG-0520.png',
      caption: 'Conference Centre staff entrance',
    },
    {
      kicker: 'Step 2',
      title: 'Go to the staff meeting point',
      copy: `Wait in the lobby area so ${supervisorName} can verify your badge, check you in, and assign your station.`,
      image: 'https://i.postimg.cc/ncqscqhw/IMG-0525.jpg',
      caption: 'Staff check-in & meeting point',
    },
    {
      kicker: 'Before You Start',
      title: 'Important Reminders',
      bullets: [
        'Arrive 10 minutes early so you have time to get organized.',
        `Dress code: ${dressCode || 'Formal all black attire required.'}`,
        `Keep your phone charged and available in case ${supervisorName} needs to contact you.`,
        'Ensure location permissions are allowed on your phone to clock in.',
      ],
    },
  ];

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const slide = slides[currentSlide];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-xs">
      <div className="relative w-full max-w-md overflow-hidden bg-white shadow-2xl rounded-2xl border border-stone-200">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 flex items-center justify-center w-8 h-8 rounded-full bg-stone-100/90 text-stone-700 hover:bg-stone-200 transition-colors"
          title="Close guide"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6">
          {slide.image && (
            <div className="mb-4 overflow-hidden rounded-xl bg-stone-100 border border-stone-200 aspect-4/3 flex flex-col items-center justify-center">
              <img src={slide.image} alt={slide.caption || slide.title} className="w-full h-full object-cover" />
            </div>
          )}
          {slide.caption && (
            <div className="text-xs text-stone-600 mb-2 font-mono">{slide.caption}</div>
          )}

          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-rose-700 mb-1">
            {slide.kicker}
          </div>
          <h3 className="text-xl font-bold text-stone-900 tracking-tight mb-2">
            {slide.title}
          </h3>
          {slide.copy && (
            <p className="text-sm text-stone-600 leading-relaxed mb-4">
              {slide.copy}
            </p>
          )}

          {slide.bullets && (
            <div className="flex flex-col gap-2.5 my-4">
              {slide.bullets.map((b, i) => (
                <div key={i} className="flex gap-2.5 items-start text-sm text-stone-700 bg-stone-50 border border-stone-200/80 p-3 rounded-xl">
                  <span className="text-rose-600 font-bold">•</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="px-6 pb-6 pt-2 flex items-center justify-between border-t border-stone-100">
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <span
                key={i}
                className={`h-2 rounded-full transition-all duration-200 ${
                  i === currentSlide ? 'w-6 bg-rose-700' : 'w-2 bg-stone-300'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {currentSlide > 0 && (
              <button
                onClick={handlePrev}
                className="px-3.5 py-2 text-sm font-semibold rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 flex items-center gap-1 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white flex items-center gap-1 shadow-xs transition-colors"
            >
              {currentSlide === slides.length - 1 ? 'Got it' : 'Next'} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
