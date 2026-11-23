-- Ease ROI cost-weighting exponent from 0.50 to 0.30 so high-impact multi-mode
-- Dragon Highborn heroes are penalized less harshly in Overall priority.
update public.recommendation_settings
set value = 0.30
where key = 'cost_weight_exponent';
