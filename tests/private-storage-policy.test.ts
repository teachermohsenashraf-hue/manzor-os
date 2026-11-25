import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessFile, validateFile, MAX_FILE_BYTES } from '../src/lib/private-storage-policy';

const project = { teamId: 'one', executorId: 'executor', team: { communicatorId: 'communicator' }, client: { lead: { teamId: 'one' } } };
test('file names, types and limits reject traversal and spoofing', () => {
  assert.equal(validateFile('preview.mp4', 'video/mp4', 500), 'mp4');
  for (const name of ['../secret.pdf', 'folder/secret.pdf', 'folder\\secret.pdf', '..', 'secret.exe'])
    assert.throws(() => validateFile(name, 'application/pdf', 100));
  assert.throws(() => validateFile('preview.mp4', 'application/pdf', 100));
  assert.throws(() => validateFile('preview.mp4', 'video/mp4', MAX_FILE_BYTES + 1));
});
test('team and file role checks protect source and cross-team files', () => {
  assert.equal(canAccessFile({ id: 'owner', role: 'OWNER' }, project, 'SOURCE', 'download'), true);
  assert.equal(canAccessFile({ id: 'executor', role: 'EXECUTION' }, project, 'SOURCE', 'download'), true);
  assert.equal(canAccessFile({ id: 'other', role: 'EXECUTION' }, project, 'SOURCE', 'download'), false);
  assert.equal(canAccessFile({ id: 'communicator', role: 'COMMUNICATION' }, project, 'SOURCE', 'download'), false);
  assert.equal(canAccessFile({ id: 'communicator', role: 'COMMUNICATION' }, project, 'PREVIEW', 'download'), true);
  assert.equal(canAccessFile({ id: 'communicator', role: 'COMMUNICATION' }, project, 'PREVIEW', 'upload'), false);
  assert.equal(canAccessFile({ id: 'communicator', role: 'COMMUNICATION' }, { ...project, client: { lead: { teamId: 'two' } } }, 'PREVIEW', 'download'), false);
});
