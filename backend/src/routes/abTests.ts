import { Router, Request, Response } from 'express';
import { createTest, listTests, getTest, deleteTest, getResults } from '../services/abTest';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  return res.json(listTests());
});

router.get('/:id', (req: Request, res: Response) => {
  const test = getTest(req.params.id);
  if (!test) return res.status(404).json({ error: 'Not found' });
  return res.json(test);
});

router.get('/:id/results', (req: Request, res: Response) => {
  const results = getResults(req.params.id);
  if (!results) return res.status(404).json({ error: 'Not found' });
  return res.json(results);
});

router.post('/', (req: Request, res: Response) => {
  const { name, step_id, variant_a_text, variant_b_text } = req.body;
  if (!name || !variant_a_text || !variant_b_text) {
    return res.status(400).json({ error: 'name, variant_a_text, variant_b_text required' });
  }
  const test = createTest(name, step_id ?? null, variant_a_text, variant_b_text);
  return res.status(201).json(test);
});

router.delete('/:id', (req: Request, res: Response) => {
  const test = getTest(req.params.id);
  if (!test) return res.status(404).json({ error: 'Not found' });
  deleteTest(req.params.id);
  return res.json({ ok: true });
});

export default router;
