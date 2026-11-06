import { Router } from 'express';
import {
  createEmployeeController,
  deactivateEmployeeController,
  getEmployeeController,
  listEmployeesController,
  updateEmployeeController,
} from '../controllers/employeeController.js';
import authenticate from '../middleware/authenticate.js';
import requireRole from '../middleware/requireRole.js';

const router = Router();

router.use(authenticate, requireRole('hr'));

router.post('/', createEmployeeController);
router.get('/', listEmployeesController);
router.get('/:id', getEmployeeController);
router.put('/:id', updateEmployeeController);
router.patch('/:id/deactivate', deactivateEmployeeController);

export default router;
