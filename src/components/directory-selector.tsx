import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { LuCheck } from 'react-icons/lu';
import {
  directoryAtom,
  directoryFieldInvalidAtom,
  includeSubdirectoriesAtom,
} from '../atoms/directory';
import { openDirectory } from '../lib/fs';
import { splitAbsolutePath } from '../lib/paths';

export function DirectorySelector() {
  const [directory, setDirectory] = useAtom(directoryAtom);
  const [directoryFieldInvalid, setDirectoryFieldInvalid] = useAtom(directoryFieldInvalidAtom);
  const [includeSubdirectories, setIncludeSubdirectories] = useAtom(includeSubdirectoriesAtom);

  useEffect(() => {
    const directory = localStorage.getItem('directory');
    if (directory) {
      setDirectory(directory);
    }
    setIncludeSubdirectories(localStorage.getItem('includeSubdirectories') === 'true');
  }, []);

  const chooseDirectory = async () => {
    const result = await openDirectory();
    if (!result) return;

    localStorage.setItem('directory', result);
    setDirectory(result);

    setDirectoryFieldInvalid(false);
  };

  const toggleSubdirectories = (checked: boolean) => {
    localStorage.setItem('includeSubdirectories', String(checked));
    setIncludeSubdirectories(checked);
  };

  const path = directory ? splitAbsolutePath(directory) : null;

  return (
    <section aria-labelledby="source-heading" className="flex flex-col gap-3.5">
      <h2 id="source-heading" className="eyebrow">
        Source
      </h2>

      {path ? (
        <p title={directory ?? undefined} className="flex flex-col gap-0.5 break-all">
          {path.parent && <span className="font-mono text-[13px] text-muted">{path.parent}</span>}
          <span className="text-[34px] leading-[1.1] font-extrabold tracking-[-0.02em]">
            {path.name}
          </span>
        </p>
      ) : (
        <p
          className={`text-[22px] leading-tight font-light ${directoryFieldInvalid ? 'text-danger' : 'text-muted'}`}
        >
          {directoryFieldInvalid ? 'Choose a folder to search first' : 'No folder chosen'}
        </p>
      )}

      <button
        type="button"
        onClick={chooseDirectory}
        className="cursor-pointer self-start rounded-[10px] border border-line-strong px-4 py-2.5 text-[15px] font-medium transition-colors hover:border-accent-ink hover:text-accent-ink"
      >
        Choose directory
      </button>

      <label className="flex cursor-pointer items-center gap-2.5 text-[15px] select-none">
        <input
          type="checkbox"
          checked={includeSubdirectories}
          onChange={(e) => toggleSubdirectories(e.currentTarget.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="flex size-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] border-line-strong text-on-accent transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ink"
        >
          {includeSubdirectories && <LuCheck className="size-3.5" strokeWidth={3} />}
        </span>
        Include subdirectories
      </label>
    </section>
  );
}
