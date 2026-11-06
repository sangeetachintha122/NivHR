import path from 'node:path';
import multer from 'multer';

const acceptedMimeTypes = {
  '.pdf': new Set(['application/pdf']),
  '.txt': new Set(['text/plain']),
  '.md': new Set(['text/markdown', 'text/x-markdown', 'text/plain']),
};

const fileFilter = (_req, file, callback) => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!acceptedMimeTypes[extension]?.has(file.mimetype)) {
    const error = new Error('Unsupported or mismatched policy file type');
    error.statusCode = 400;
    callback(error);
    return;
  }
  callback(null, true);
};

const uploadPolicyFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter,
}).single('file');

export default uploadPolicyFile;
