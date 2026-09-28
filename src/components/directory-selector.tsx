import { Button, Text } from '@chakra-ui/react';
import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { directoryAtom, directoryFieldInvalidAtom } from '../atoms/directory';
import { openDirectory } from '../api/fs';

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
      <Button colorPalette="blue" onClick={chooseDirectory}>
        Choose Directory
      </Button>
      {(directory || directoryFieldInvalid) && (
        <Text color={directoryFieldInvalid ? 'red.500' : 'initial'} mt={4}>
          {directoryFieldInvalid ? 'Please select a directory' : `Selected: ${directory}`}
        </Text>
      )}
    </>
  );
}
