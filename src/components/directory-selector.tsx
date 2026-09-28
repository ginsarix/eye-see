import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { directoryAtom, directoryFieldInvalidAtom } from '../atoms/directory';
import { openDirectory } from '../lib/fs';
import { Button } from './ui/button';

export function DirectorySelector() {
  const [directory, setDirectory] = useAtom(directoryAtom);
  const [directoryFieldInvalid, setDirectoryFieldInvalid] = useAtom(directoryFieldInvalidAtom);

  useEffect(() => {
    const directory = localStorage.getItem('directory');
    if (directory) {
      setDirectory(directory);
    }
  }, []);

  const chooseDirectory = async () => {
    const result = await openDirectory();
    if (!result) return;

    localStorage.setItem('directory', result);
    setDirectory(result);

    setDirectoryFieldInvalid(false);
  };
  return (
    <>
      <Button onClick={chooseDirectory}>Choose Directory</Button>
      {(directory || directoryFieldInvalid) && (
        <p className={`mt-4 ${directoryFieldInvalid ? 'text-red-500' : ''}`}>
          {directoryFieldInvalid ? 'Please select a directory' : `Selected: ${directory}`}
        </p>
      )}
    </>
  );
}
