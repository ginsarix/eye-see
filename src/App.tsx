import { useEffect } from "react";
import { getSimilarImages } from "./domain/similarity";

export default function App() {
    useEffect(() => console.log(JSON.stringify(getSimilarImages('a smiling monkey'))), [])

  return <h1>Hello, world</h1>;
}
